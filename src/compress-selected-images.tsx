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
            title: "No Images Selected",
            message: "Select images in Finder and run the command again",
          });
          if (!disposed) setState({ kind: "fatal", message: "Select images in Finder first" });
          return;
        }

        const { tasks, supportedCount } = buildTasksFromFinderSelection(finderItems);
        if (supportedCount === 0) {
          await showToast({
            style: Toast.Style.Failure,
            title: "No Supported Images Found",
            message: "Supported formats: jpg, jpeg, png, webp, avif",
          });
          if (!disposed) {
            setState({
              kind: "fatal",
              message: "No supported images found (supports jpg, jpeg, png, webp, avif)",
            });
          }
          return;
        }

        if (!disposed) {
          setState({ kind: "ready", tasks, initialSettings: defaultSettings });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to read Finder selection";
        await showToast({ style: Toast.Style.Failure, title: "Failed to Read Finder Selection", message });
        if (!disposed) setState({ kind: "fatal", message });
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  async function handleInitialSettingsSave(nextSettings: CompressionSettingsV1): Promise<boolean> {
    await saveDefaultCompressionSettings(nextSettings);
    await showToast({ style: Toast.Style.Success, title: "Default settings saved" });

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
        <List.EmptyView title="Unable to Start Compression" description={state.message} />
      </List>
    );
  }

  if (state.initialSettings == null) {
    return (
      <CompressionSettingsForm
        navigationTitle="Initial Compression Settings"
        submitTitle="Save and Start Compression"
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
