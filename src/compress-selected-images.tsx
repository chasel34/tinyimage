import { List, Toast, getSelectedFinderItems, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import { CompressionSettingsForm } from "./components/CompressionSettingsForm";
import { CompressionTaskList } from "./components/CompressionTaskList";
import { buildTasksFromFinderSelection } from "./lib/finder";
import { loadDefaultCompressionSettings, saveDefaultCompressionSettings } from "./lib/settings";
import { CompressionSettingsV1, ImageTaskItem } from "./types";

type LoadState =
  | { kind: "loading" }
  | { kind: "fatal"; message: string }
  | {
      kind: "ready";
      tasks: ImageTaskItem[];
      initialSettings: CompressionSettingsV1 | null;
    };

export default function CompressSelectedImagesCommand() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const [finderItems, defaultSettings] = await Promise.all([
          getSelectedFinderItems(),
          loadDefaultCompressionSettings(),
        ]);

        if (finderItems.length === 0) {
          await showToast({
            style: Toast.Style.Failure,
            title: "未选择图片",
            message: "请先在 Finder 中选择图片后再运行命令",
          });
          if (!disposed) setState({ kind: "fatal", message: "请先在 Finder 中选择图片" });
          return;
        }

        const { tasks, supportedCount } = buildTasksFromFinderSelection(finderItems);
        if (supportedCount === 0) {
          await showToast({
            style: Toast.Style.Failure,
            title: "没有可压缩图片",
            message: "仅支持 jpg/jpeg/png/webp/avif",
          });
          if (!disposed) setState({ kind: "fatal", message: "未找到支持的图片格式（仅支持 jpg/jpeg/png/webp/avif）" });
          return;
        }

        if (!disposed) {
          setState({ kind: "ready", tasks, initialSettings: defaultSettings });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取 Finder 选中项失败";
        await showToast({ style: Toast.Style.Failure, title: "读取 Finder 选中项失败", message });
        if (!disposed) setState({ kind: "fatal", message });
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  async function handleInitialSettingsSave(nextSettings: CompressionSettingsV1): Promise<boolean> {
    await saveDefaultCompressionSettings(nextSettings);
    await showToast({ style: Toast.Style.Success, title: "默认设置已保存" });

    setState((previous) => {
      if (previous.kind !== "ready") return previous;
      return {
        kind: "ready",
        tasks: previous.tasks,
        initialSettings: nextSettings,
      };
    });
    return true;
  }

  if (state.kind === "loading") {
    return <List isLoading navigationTitle="TinyImage" />;
  }

  if (state.kind === "fatal") {
    return (
      <List navigationTitle="TinyImage">
        <List.EmptyView title="无法开始压缩" description={state.message} />
      </List>
    );
  }

  if (state.initialSettings == null) {
    return (
      <CompressionSettingsForm
        navigationTitle="首次压缩设置"
        submitTitle="保存并开始压缩"
        initialSettings={{
          schemaVersion: 1,
          outputMode: "generate-new",
          formatMode: "keep-original",
          targetFormat: "webp",
          quality: 80,
          pngCompressionLevel: 6,
          keepMetadata: false,
        }}
        onSubmitSettings={handleInitialSettingsSave}
      />
    );
  }

  return <CompressionTaskList initialTasks={state.tasks} initialSettings={state.initialSettings} />;
}
