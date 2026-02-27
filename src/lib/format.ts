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

  if (nodeError?.code === "ENOENT") return "File does not exist or was moved";
  if (nodeError?.code === "EACCES" || nodeError?.code === "EPERM") return "No write permission";
  if (nodeError?.code === "EISDIR") return "Not a file; cannot compress";
  if (/Input file contains unsupported image format/i.test(message))
    return "Image cannot be parsed or format is unsupported";
  if (/unsupported image format/i.test(message)) return "Image cannot be parsed or format is unsupported";
  if (/Input file is missing/i.test(message)) return "File does not exist or was moved";
  if (/VipsJpeg|corrupt|Corrupt|bad seek|Premature end/i.test(message)) return "Image cannot be parsed or is corrupted";

  return message || fallback;
}

export function getTaskStatusLabel(item: ImageTaskItem): string {
  if (item.writeStatus === "writing") return "Writing";
  if (item.writeStatus === "written") return "Done";
  if (item.writeStatus === "write-failed") return "Failed";

  switch (item.computeStatus) {
    case "unsupported":
      return "Failed";
    case "pending":
      return "Pending";
    case "computing":
      return "Precomputing";
    case "ready":
      return "Writable";
    case "compute-failed":
      return "Failed";
    default:
      return "Pending";
  }
}

export function isComputeTerminalStatus(status: ComputeStatus): boolean {
  return status === "unsupported" || status === "ready" || status === "compute-failed";
}

export function isWriteTerminalStatus(status: WriteStatus): boolean {
  return status === "idle" || status === "written" || status === "write-failed";
}
