import { ComputeStatus, ImageTaskItem, WriteStatus } from "../types";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "N/A";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function calculatePercentChange(originalBytes: number | null, outputBytes: number | null): number | null {
  if (!originalBytes || originalBytes <= 0 || !outputBytes || outputBytes < 0) return null;
  return ((originalBytes - outputBytes) / originalBytes) * 100;
}

export function formatPercentChange(percent: number | null): string {
  if (percent == null || !Number.isFinite(percent)) return "N/A";
  const sign = percent >= 0 ? "-" : "+";
  return `${sign}${Math.abs(percent).toFixed(1)}%`;
}

export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

export function mapFsOrSharpErrorToMessage(error: unknown, fallback: string): string {
  const message = toErrorMessage(error, fallback);
  const nodeError = error as NodeJS.ErrnoException | undefined;

  if (nodeError?.code === "ENOENT") return "文件不存在或已被移动";
  if (nodeError?.code === "EACCES" || nodeError?.code === "EPERM") return "无写入权限";
  if (nodeError?.code === "EISDIR") return "不是文件，无法压缩";
  if (/Input file contains unsupported image format/i.test(message)) return "图片无法解析或格式不受支持";
  if (/unsupported image format/i.test(message)) return "图片无法解析或格式不受支持";
  if (/Input file is missing/i.test(message)) return "文件不存在或已被移动";
  if (/VipsJpeg|corrupt|Corrupt|bad seek|Premature end/i.test(message)) return "图片无法解析或已损坏";

  return message || fallback;
}

export function getTaskStatusLabel(item: ImageTaskItem): string {
  if (item.writeStatus === "writing") return "写入中";
  if (item.writeStatus === "written") return "已完成";
  if (item.writeStatus === "write-failed") return "失败";

  switch (item.computeStatus) {
    case "unsupported":
      return "失败";
    case "pending":
      return "待处理";
    case "computing":
      return "预计算中";
    case "ready":
      return "可写入";
    case "compute-failed":
      return "失败";
    default:
      return "待处理";
  }
}

export function isComputeTerminalStatus(status: ComputeStatus): boolean {
  return status === "unsupported" || status === "ready" || status === "compute-failed";
}

export function isWriteTerminalStatus(status: WriteStatus): boolean {
  return status === "idle" || status === "written" || status === "write-failed";
}
