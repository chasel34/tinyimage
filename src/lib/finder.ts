import path from "node:path";
import { FileSystemItem } from "@raycast/api";
import { BuildTasksResult, ImageTaskItem } from "../types";
import { isSupportedInputExtension, normalizeExtension } from "./pathing";

function buildUnsupportedReason(ext: string | null): string {
  if (!ext) return "Missing file extension; cannot identify image format";
  return `Unsupported format: ${ext}`;
}

export function buildTasksFromFinderSelection(items: FileSystemItem[]): BuildTasksResult {
  const tasks: ImageTaskItem[] = items.map((item, index) => {
    const ext = normalizeExtension(item.path);
    const supported = isSupportedInputExtension(ext);

    return {
      id: `${index}:${item.path}`,
      orderIndex: index,
      originalSelectedPath: item.path,
      currentSourcePath: item.path,
      displayName: path.basename(item.path),
      sourceExtLower: ext,
      sourceSizeBytes: null,
      computeStatus: supported ? "pending" : "unsupported",
      writeStatus: "idle",
      computeError: supported ? null : buildUnsupportedReason(ext),
      writeError: null,
      computed: null,
      writtenOutputPath: null,
      lastKnownOutputBytes: null,
      settingsRevision: 0,
    };
  });

  const supportedCount = tasks.filter((task) => task.computeStatus !== "unsupported").length;
  return { tasks, supportedCount };
}
