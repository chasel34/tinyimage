import path from "node:path";
import { Action, ActionPanel, Color, Icon, List, Toast, confirmAlert, showToast, useNavigation } from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { precomputeImageTask } from "../lib/compress";
import { runWithConcurrency } from "../lib/concurrency";
import {
  calculatePercentChange,
  formatBytes,
  formatPercentChange,
  getTaskStatusLabel,
  isComputeTerminalStatus,
} from "../lib/format";
import { FIXED_CONCURRENCY } from "../lib/settings";
import { writeComputedImageTask } from "../lib/write";
import { CompressionSettingsV1, ImageTaskItem } from "../types";
import { CompressionSettingsForm } from "./CompressionSettingsForm";

interface CompressionTaskListProps {
  initialTasks: ImageTaskItem[];
  initialSettings: CompressionSettingsV1;
}

function cloneTasks(tasks: ImageTaskItem[]): ImageTaskItem[] {
  return tasks.map((task) => ({ ...task }));
}

function resetTaskForNewRevision(task: ImageTaskItem, nextRevision: number): ImageTaskItem {
  const unsupported = task.computeStatus === "unsupported";

  return {
    ...task,
    sourceSizeBytes: unsupported ? task.sourceSizeBytes : null,
    computeStatus: unsupported ? "unsupported" : "pending",
    writeStatus: "idle",
    computeError: unsupported ? task.computeError : null,
    writeError: null,
    computed: null,
    writtenOutputPath: null,
    lastKnownOutputBytes: null,
    settingsRevision: nextRevision,
  };
}

function isItemWritable(task: ImageTaskItem): boolean {
  return task.computeStatus === "ready" && task.computed !== null && task.writeStatus !== "writing";
}

function formatTargetFormatLabel(format: CompressionSettingsV1["targetFormat"]): string {
  switch (format) {
    case "jpeg":
      return "JPEG";
    case "png":
      return "PNG";
    case "webp":
      return "WebP";
    case "avif":
      return "AVIF";
  }
}

function buildSubtitle(task: ImageTaskItem, settings: CompressionSettingsV1): string | undefined {
  const errorMessage = task.writeError ?? task.computeError;
  if (errorMessage) return errorMessage;

  if (task.writeStatus === "written" && task.writtenOutputPath) {
    return `已写入: ${path.basename(task.writtenOutputPath)}`;
  }

  if (task.computed) {
    if (settings.outputMode === "generate-new") {
      return `生成: ${path.basename(task.computed.plannedOutputPath)}`;
    }
    if (task.computed.overwriteDeletesSourceAfterWrite) {
      return `覆盖并转换为 ${formatTargetFormatLabel(task.computed.outputFormat)}: ${path.basename(task.computed.plannedOutputPath)}`;
    }
    return "覆盖原图";
  }

  if (settings.outputMode === "generate-new") {
    return settings.formatMode === "convert" ? `待生成 (${formatTargetFormatLabel(settings.targetFormat)})` : "待生成";
  }
  if (settings.formatMode === "convert") {
    return `待覆盖并转换为 ${formatTargetFormatLabel(settings.targetFormat)}`;
  }
  return "待覆盖原图";
}

function buildAccessories(task: ImageTaskItem): List.Item.Accessory[] {
  const percent = calculatePercentChange(task.sourceSizeBytes, task.lastKnownOutputBytes);
  const statusLabel = getTaskStatusLabel(task);
  const error = task.writeError ?? task.computeError;

  const accessories: List.Item.Accessory[] = [{ tag: statusLabel }];
  if (task.sourceSizeBytes != null) {
    accessories.push({ text: `原图 ${formatBytes(task.sourceSizeBytes)}` });
  }
  if (task.lastKnownOutputBytes != null) {
    accessories.push({ text: `结果 ${formatBytes(task.lastKnownOutputBytes)}` });
    accessories.push({
      text: {
        value: formatPercentChange(percent),
        color: percent == null ? undefined : percent >= 0 ? Color.Green : Color.Red,
      },
      tooltip: "相对原图变化",
    });
  }
  if (error) {
    accessories.push({ icon: Icon.ExclamationMark, tooltip: error });
  }
  return accessories;
}

export function CompressionTaskList(props: CompressionTaskListProps) {
  const { initialTasks, initialSettings } = props;
  const { push } = useNavigation();

  const [tasks, setTasks] = useState<ImageTaskItem[]>(() => cloneTasks(initialTasks));
  const [sessionSettings, setSessionSettings] = useState<CompressionSettingsV1>(initialSettings);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [isComputing, setIsComputing] = useState(false);
  const [isBatchWriting, setIsBatchWriting] = useState(false);
  const [batchWriteProgress, setBatchWriteProgress] = useState({ total: 0, done: 0 });

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const settingsRef = useRef(sessionSettings);
  settingsRef.current = sessionSettings;
  const revisionRef = useRef(settingsRevision);
  revisionRef.current = settingsRevision;

  const anyWriting = useMemo(() => tasks.some((task) => task.writeStatus === "writing"), [tasks]);
  const allPrecomputeFinished = useMemo(
    () => tasks.every((task) => isComputeTerminalStatus(task.computeStatus)),
    [tasks],
  );
  const writableCount = useMemo(() => tasks.filter(isItemWritable).length, [tasks]);
  const supportedCount = useMemo(() => tasks.filter((task) => task.computeStatus !== "unsupported").length, [tasks]);
  const precomputedTerminalCount = useMemo(
    () =>
      tasks.filter((task) => isComputeTerminalStatus(task.computeStatus) && task.computeStatus !== "unsupported")
        .length,
    [tasks],
  );
  const writeDoneCount = useMemo(() => tasks.filter((task) => task.writeStatus === "written").length, [tasks]);

  function updateTaskById(id: string, updater: (task: ImageTaskItem) => ImageTaskItem): void {
    setTasks((previous) => previous.map((task) => (task.id === id ? updater(task) : task)));
  }

  function resetSessionWithSettings(nextSettings: CompressionSettingsV1): void {
    const nextRevision = revisionRef.current + 1;
    setSessionSettings(nextSettings);
    setSettingsRevision(nextRevision);
    setBatchWriteProgress({ total: 0, done: 0 });
    setTasks((previous) => previous.map((task) => resetTaskForNewRevision(task, nextRevision)));
  }

  useEffect(() => {
    let disposed = false;
    const runRevision = revisionRef.current;
    const settingsForRun = settingsRef.current;
    const queue = tasksRef.current.filter((task) => task.computeStatus !== "unsupported").map((task) => task.id);

    if (queue.length === 0) {
      setIsComputing(false);
      return;
    }

    setIsComputing(true);

    void (async () => {
      try {
        await runWithConcurrency(queue, FIXED_CONCURRENCY, async (taskId) => {
          if (disposed || revisionRef.current !== runRevision) return;

          const snapshot = tasksRef.current.find((task) => task.id === taskId);
          if (!snapshot) return;
          if (snapshot.computeStatus === "unsupported") return;

          updateTaskById(taskId, (task) => {
            if (task.settingsRevision !== runRevision || task.computeStatus === "unsupported") return task;
            return {
              ...task,
              computeStatus: "computing",
              computeError: null,
              writeError: task.writeStatus === "writing" ? task.writeError : task.writeError,
            };
          });

          const result = await precomputeImageTask(snapshot, settingsForRun);

          if (disposed || revisionRef.current !== runRevision) return;

          updateTaskById(taskId, (task) => {
            if (task.settingsRevision !== runRevision || task.computeStatus === "unsupported") return task;

            if (!result.ok) {
              return {
                ...task,
                sourceSizeBytes: task.sourceSizeBytes,
                computeStatus: "compute-failed",
                computeError: result.errorMessage || "压缩失败（未知原因）",
                computed: null,
                lastKnownOutputBytes: null,
              };
            }

            return {
              ...task,
              sourceSizeBytes: result.sourceSizeBytes,
              computeStatus: "ready",
              computeError: null,
              computed: result.computed,
              lastKnownOutputBytes: result.computed.outputBytes,
            };
          });
        });
      } finally {
        if (!disposed && revisionRef.current === runRevision) {
          setIsComputing(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [settingsRevision]);

  async function handleApplySessionSettings(nextSettings: CompressionSettingsV1): Promise<boolean> {
    if (tasksRef.current.some((task) => task.writeStatus === "writing") || isBatchWriting) {
      await showToast({
        style: Toast.Style.Failure,
        title: "请等待写入完成",
        message: "写入进行中时不能修改本次设置",
      });
      return false;
    }

    resetSessionWithSettings(nextSettings);
    return true;
  }

  async function runWriteForItem(taskId: string): Promise<"success" | "failed" | "skipped"> {
    const snapshot = tasksRef.current.find((task) => task.id === taskId);
    if (!snapshot || !isItemWritable(snapshot)) return "skipped";

    updateTaskById(taskId, (task) => {
      if (!isItemWritable(task)) return task;
      return {
        ...task,
        writeStatus: "writing",
        writeError: null,
      };
    });

    const result = await writeComputedImageTask(snapshot, settingsRef.current);

    updateTaskById(taskId, (task) => {
      if (task.settingsRevision !== snapshot.settingsRevision) return task;

      if (result.ok) {
        const nextExt = path.extname(result.nextCurrentSourcePath).toLowerCase() || null;
        return {
          ...task,
          currentSourcePath: result.nextCurrentSourcePath,
          sourceExtLower: nextExt,
          displayName: path.basename(result.nextCurrentSourcePath),
          writeStatus: "written",
          writeError: null,
          writtenOutputPath: result.outputPath,
          lastKnownOutputBytes: result.outputBytes,
          computed: null,
        };
      }

      return {
        ...task,
        writeStatus: "write-failed",
        writeError: result.errorMessage || "写入失败（未知原因）",
        writtenOutputPath: result.partialOutputPath ?? task.writtenOutputPath,
      };
    });

    return result.ok ? "success" : "failed";
  }

  async function handleSingleWrite(taskId: string): Promise<void> {
    if (isBatchWriting) {
      await showToast({ style: Toast.Style.Failure, title: "批量写入进行中", message: "请稍后重试" });
      return;
    }

    const outcome = await runWriteForItem(taskId);
    if (outcome === "skipped") {
      await showToast({ style: Toast.Style.Failure, title: "当前项不可写入", message: "请先等待预计算完成" });
      return;
    }

    if (outcome === "success") {
      await showToast({ style: Toast.Style.Success, title: "写入完成" });
    }
  }

  async function handleBatchWrite(): Promise<void> {
    if (!allPrecomputeFinished) {
      await showToast({
        style: Toast.Style.Failure,
        title: "请等待预计算完成",
        message: "全部预计算结束后才能批量写入",
      });
      return;
    }
    if (isBatchWriting || anyWriting) {
      await showToast({ style: Toast.Style.Failure, title: "写入进行中", message: "请等待当前写入完成" });
      return;
    }

    const queue = tasksRef.current.filter(isItemWritable).map((task) => task.id);
    if (queue.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "没有可写入项",
        message: "预计算失败或已写入的图片不会重复写入",
      });
      return;
    }

    if (settingsRef.current.outputMode === "overwrite-original") {
      const confirmed = await confirmAlert({
        title: "批量覆盖原图？",
        message: "该操作不可撤销。将按当前设置写入并覆盖原图（或转换后删除原图）。",
        primaryAction: { title: "继续" },
        dismissAction: { title: "取消" },
      });
      if (!confirmed) return;
    }

    setIsBatchWriting(true);
    setBatchWriteProgress({ total: queue.length, done: 0 });

    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    try {
      await runWithConcurrency(queue, FIXED_CONCURRENCY, async (taskId) => {
        const outcome = await runWriteForItem(taskId);
        if (outcome === "success") successCount += 1;
        if (outcome === "failed") failureCount += 1;
        if (outcome === "skipped") skippedCount += 1;
        setBatchWriteProgress((previous) => ({ ...previous, done: previous.done + 1 }));
      });
    } finally {
      setIsBatchWriting(false);
    }

    await showToast({
      style: failureCount > 0 ? Toast.Style.Failure : Toast.Style.Success,
      title: "批量写入完成",
      message: `成功 ${successCount}，失败 ${failureCount}，跳过 ${skippedCount}`,
    });
  }

  function openSessionSettings(): void {
    push(
      <CompressionSettingsForm
        navigationTitle="本次压缩设置"
        submitTitle="应用设置"
        initialSettings={sessionSettings}
        popOnSubmit
        onSubmitSettings={handleApplySessionSettings}
      />,
    );
  }

  const navigationTitle = useMemo(() => {
    if (isBatchWriting) {
      return `TinyImage · 写入 ${batchWriteProgress.done}/${batchWriteProgress.total}`;
    }
    if (!allPrecomputeFinished || isComputing) {
      return `TinyImage · 预计算 ${precomputedTerminalCount}/${supportedCount}`;
    }
    return `TinyImage · 已就绪 ${writableCount} 项 · 已完成 ${writeDoneCount}`;
  }, [
    allPrecomputeFinished,
    batchWriteProgress.done,
    batchWriteProgress.total,
    isBatchWriting,
    isComputing,
    precomputedTerminalCount,
    supportedCount,
    writableCount,
    writeDoneCount,
  ]);

  return (
    <List navigationTitle={navigationTitle} isLoading={isComputing || anyWriting || isBatchWriting}>
      {tasks.map((task) => {
        const canOpenResult = task.writeStatus === "written" && Boolean(task.writtenOutputPath);

        return (
          <List.Item
            key={task.id}
            id={task.id}
            title={task.displayName}
            subtitle={buildSubtitle(task, sessionSettings)}
            icon={task.currentSourcePath}
            accessories={buildAccessories(task)}
            quickLook={{ path: task.currentSourcePath }}
            actions={
              <ActionPanel>
                <ActionPanel.Section title="批量操作">
                  {allPrecomputeFinished ? (
                    <Action title={`批量写入全部可写入项 (${writableCount})`} onAction={handleBatchWrite} />
                  ) : (
                    <Action
                      title="批量写入（等待预计算完成）"
                      onAction={async () =>
                        showToast({
                          style: Toast.Style.Failure,
                          title: "请等待预计算完成",
                          message: "全部预计算结束后才能批量写入",
                        })
                      }
                    />
                  )}
                  <Action title="修改本次设置" onAction={openSessionSettings} />
                </ActionPanel.Section>

                <ActionPanel.Section title="当前图片">
                  <Action
                    title="单项写入"
                    onAction={() => handleSingleWrite(task.id)}
                    shortcut={{ modifiers: ["cmd"], key: "s" }}
                  />
                  <Action.ShowInFinder path={task.currentSourcePath} />
                  <Action.Open title="打开原图" target={task.currentSourcePath} />
                  {canOpenResult && task.writtenOutputPath ? (
                    <Action.Open title="打开压缩结果" target={task.writtenOutputPath} />
                  ) : null}
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

export default CompressionTaskList;
