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

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);

  const keep = maxLength - 3;
  const left = Math.ceil(keep / 2);
  const right = Math.floor(keep / 2);
  return `${text.slice(0, left)}...${text.slice(text.length - right)}`;
}

function shortenFileNameForUI(fileName: string): string {
  return truncateMiddle(fileName, 28);
}

function buildPlanLabel(task: ImageTaskItem, settings: CompressionSettingsV1): string | null {
  if (task.writeStatus === "written") {
    return null;
  }

  if (task.computed) {
    if (settings.outputMode === "generate-new") {
      return "Generate New";
    }
    if (task.computed.overwriteDeletesSourceAfterWrite) {
      return `Overwrite + ${formatTargetFormatLabel(task.computed.outputFormat)}`;
    }
    return "Overwrite";
  }

  if (settings.outputMode === "generate-new") {
    return settings.formatMode === "convert"
      ? `Generate (${formatTargetFormatLabel(settings.targetFormat)})`
      : "Generate New";
  }
  if (settings.formatMode === "convert") {
    return `Overwrite + ${formatTargetFormatLabel(settings.targetFormat)}`;
  }
  return "Overwrite";
}

function buildSubtitle(task: ImageTaskItem, settings: CompressionSettingsV1): string | undefined {
  const errorMessage = task.writeError ?? task.computeError;
  if (errorMessage) return errorMessage;

  if (task.writeStatus === "written" && task.writtenOutputPath) {
    return `Written: ${shortenFileNameForUI(path.basename(task.writtenOutputPath))}`;
  }

  if (task.computed && settings.outputMode === "generate-new") {
    return `Output: ${shortenFileNameForUI(path.basename(task.computed.plannedOutputPath))}`;
  }

  return undefined;
}

function buildAccessories(task: ImageTaskItem, settings: CompressionSettingsV1): List.Item.Accessory[] {
  const percent = calculatePercentChange(task.sourceSizeBytes, task.lastKnownOutputBytes);
  const statusLabel = getTaskStatusLabel(task);
  const error = task.writeError ?? task.computeError;
  const planLabel = buildPlanLabel(task, settings);

  const accessories: List.Item.Accessory[] = [{ tag: statusLabel }];
  if (planLabel) {
    accessories.push({ tag: planLabel });
  }
  if (task.sourceSizeBytes != null) {
    accessories.push({
      text: `Original ${formatBytes(task.sourceSizeBytes)}`,
      tooltip: `Original ${formatBytes(task.sourceSizeBytes)}`,
    });
  }
  if (task.lastKnownOutputBytes != null) {
    accessories.push({
      text: `Result ${formatBytes(task.lastKnownOutputBytes)}`,
      tooltip: `Result ${formatBytes(task.lastKnownOutputBytes)}`,
    });
    accessories.push({
      text: {
        value: formatPercentChange(percent),
        color: percent == null ? undefined : percent >= 0 ? Color.Green : Color.Red,
      },
      tooltip: "Change vs original",
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
              writeError: null,
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
                computeError: result.errorMessage || "Compression failed (unknown error)",
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
        title: "Wait for Writes to Finish",
        message: "You can't change session settings while writing is in progress",
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
        writeError: result.errorMessage || "Write failed (unknown error)",
        writtenOutputPath: result.partialOutputPath ?? task.writtenOutputPath,
      };
    });

    return result.ok ? "success" : "failed";
  }

  async function handleSingleWrite(taskId: string): Promise<void> {
    if (isBatchWriting) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Batch Write in Progress",
        message: "Try again in a moment",
      });
      return;
    }

    const outcome = await runWriteForItem(taskId);
    if (outcome === "skipped") {
      await showToast({
        style: Toast.Style.Failure,
        title: "Item Is Not Writable Yet",
        message: "Wait for precompute to finish first",
      });
      return;
    }

    if (outcome === "success") {
      await showToast({ style: Toast.Style.Success, title: "Write Complete" });
    }
  }

  async function handleBatchWrite(): Promise<void> {
    if (!allPrecomputeFinished) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Wait for Precompute to Finish",
        message: "Batch write is available only after all precompute tasks finish",
      });
      return;
    }
    if (isBatchWriting || anyWriting) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Write in Progress",
        message: "Wait for current writes to finish",
      });
      return;
    }

    const queue = tasksRef.current.filter(isItemWritable).map((task) => task.id);
    if (queue.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No Writable Items",
        message: "Items that failed precompute or were already written won't be written again",
      });
      return;
    }

    if (settingsRef.current.outputMode === "overwrite-original") {
      const confirmed = await confirmAlert({
        title: "Overwrite Originals in Batch?",
        message:
          "This action cannot be undone. It will overwrite original files (or delete originals after conversion).",
        primaryAction: { title: "Continue" },
        dismissAction: { title: "Cancel" },
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
      title: "Batch Write Finished",
      message: `Succeeded ${successCount}, Failed ${failureCount}, Skipped ${skippedCount}`,
    });
  }

  function openSessionSettings(): void {
    push(
      <CompressionSettingsForm
        navigationTitle="Session Compression Settings"
        submitTitle="Apply Settings"
        initialSettings={sessionSettings}
        popOnSubmit
        onSubmitSettings={handleApplySessionSettings}
      />,
    );
  }

  const navigationTitle = useMemo(() => {
    if (isBatchWriting) {
      return `TinyImage · Writing ${batchWriteProgress.done}/${batchWriteProgress.total}`;
    }
    if (!allPrecomputeFinished || isComputing) {
      return `TinyImage · Precompute ${precomputedTerminalCount}/${supportedCount}`;
    }
    return `TinyImage · Ready ${writableCount} · Done ${writeDoneCount}`;
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
            title={{ value: shortenFileNameForUI(task.displayName), tooltip: task.displayName }}
            subtitle={buildSubtitle(task, sessionSettings)}
            icon={task.currentSourcePath}
            accessories={buildAccessories(task, sessionSettings)}
            quickLook={{ path: task.currentSourcePath }}
            actions={
              <ActionPanel>
                <ActionPanel.Section title="Batch Actions">
                  {allPrecomputeFinished ? (
                    <Action title={`Write All Writable Items (${writableCount})`} onAction={handleBatchWrite} />
                  ) : (
                    <Action
                      title="Batch Write (Waiting for Precompute)"
                      onAction={async () =>
                        showToast({
                          style: Toast.Style.Failure,
                          title: "Wait for Precompute to Finish",
                          message: "Batch write is available only after all precompute tasks finish",
                        })
                      }
                    />
                  )}
                  <Action title="Edit Session Settings" onAction={openSessionSettings} />
                </ActionPanel.Section>

                <ActionPanel.Section title="Current Image">
                  <Action
                    title="Write This Item"
                    onAction={() => handleSingleWrite(task.id)}
                    shortcut={{ modifiers: ["cmd"], key: "s" }}
                  />
                  <Action.ShowInFinder path={task.currentSourcePath} />
                  <Action.Open title="Open Original" target={task.currentSourcePath} />
                  {canOpenResult && task.writtenOutputPath ? (
                    <Action.Open title="Open Compressed Result" target={task.writtenOutputPath} />
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
