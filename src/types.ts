export type OutputMode = "generate-new" | "overwrite-original";
export type FormatMode = "keep-original" | "convert";
export type TargetFormat = "jpeg" | "png" | "webp" | "avif";

export interface CompressionSettingsV1 {
  schemaVersion: 1;
  outputMode: OutputMode;
  formatMode: FormatMode;
  targetFormat: TargetFormat;
  quality: number;
  pngCompressionLevel: number;
  keepMetadata: boolean;
}

export type ComputeStatus = "unsupported" | "pending" | "computing" | "ready" | "compute-failed";
export type WriteStatus = "idle" | "writing" | "written" | "write-failed";

export interface ComputedBuffer {
  buffer: Buffer;
  outputFormat: TargetFormat;
  outputBytes: number;
  plannedOutputPath: string;
  overwriteDeletesSourceAfterWrite: boolean;
}

export interface ImageTaskItem {
  id: string;
  orderIndex: number;
  originalSelectedPath: string;
  currentSourcePath: string;
  displayName: string;
  sourceExtLower: string | null;
  sourceSizeBytes: number | null;
  computeStatus: ComputeStatus;
  writeStatus: WriteStatus;
  computeError: string | null;
  writeError: string | null;
  computed: ComputedBuffer | null;
  writtenOutputPath: string | null;
  lastKnownOutputBytes: number | null;
  settingsRevision: number;
}

export interface BuildTasksResult {
  tasks: ImageTaskItem[];
  supportedCount: number;
}

export interface PrecomputeSuccess {
  ok: true;
  sourceSizeBytes: number;
  computed: ComputedBuffer;
}

export interface PrecomputeFailure {
  ok: false;
  errorMessage: string;
}

export type PrecomputeResult = PrecomputeSuccess | PrecomputeFailure;

export interface WriteSuccessResult {
  ok: true;
  outputPath: string;
  outputBytes: number;
  nextCurrentSourcePath: string;
}

export interface WriteFailureResult {
  ok: false;
  errorMessage: string;
  partialOutputPath?: string;
}

export type WriteResult = WriteSuccessResult | WriteFailureResult;

export interface CompressionSettingsFormValues {
  outputMode: OutputMode;
  formatMode: FormatMode;
  targetFormat?: TargetFormat;
  quality: string;
  pngCompressionLevel: string;
  keepMetadata: boolean;
}
