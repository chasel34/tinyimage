import path from "node:path";
import { FileSystemItem } from "@raycast/api";
import { BuildTasksResult, ImageTaskItem } from "../types";
import { isSupportedInputExtension, normalizeExtension } from "./pathing";

function buildUnsupportedReason(ext: string | null): string {
  if (!ext) return "缺少文件扩展名，无法识别图片格式";
  return `不支持的格式: ${ext}`;
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
