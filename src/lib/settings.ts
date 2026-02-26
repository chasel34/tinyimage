import { LocalStorage } from "@raycast/api";
import { CompressionSettingsV1, FormatMode, OutputMode, TargetFormat } from "../types";

export const DEFAULT_SETTINGS_STORAGE_KEY = "tinyimage.default-settings.v1";
export const FIXED_CONCURRENCY = 2;

const VALID_OUTPUT_MODES = new Set<OutputMode>(["generate-new", "overwrite-original"]);
const VALID_FORMAT_MODES = new Set<FormatMode>(["keep-original", "convert"]);
const VALID_TARGET_FORMATS = new Set<TargetFormat>(["jpeg", "png", "webp", "avif"]);

export function createDefaultCompressionSettings(): CompressionSettingsV1 {
  return {
    schemaVersion: 1,
    outputMode: "generate-new",
    formatMode: "keep-original",
    targetFormat: "webp",
    quality: 80,
    pngCompressionLevel: 6,
    keepMetadata: false,
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeCompressionSettings(
  input: Partial<CompressionSettingsV1> | null | undefined,
): CompressionSettingsV1 {
  const defaults = createDefaultCompressionSettings();

  const outputMode = VALID_OUTPUT_MODES.has(input?.outputMode as OutputMode)
    ? (input?.outputMode as OutputMode)
    : defaults.outputMode;
  const formatMode = VALID_FORMAT_MODES.has(input?.formatMode as FormatMode)
    ? (input?.formatMode as FormatMode)
    : defaults.formatMode;
  const targetFormat = VALID_TARGET_FORMATS.has(input?.targetFormat as TargetFormat)
    ? (input?.targetFormat as TargetFormat)
    : defaults.targetFormat;

  const quality = clampNumber(Number(input?.quality ?? defaults.quality), 1, 100);
  const pngCompressionLevel = clampNumber(Number(input?.pngCompressionLevel ?? defaults.pngCompressionLevel), 0, 9);
  const keepMetadata = typeof input?.keepMetadata === "boolean" ? input.keepMetadata : defaults.keepMetadata;

  return {
    schemaVersion: 1,
    outputMode,
    formatMode,
    targetFormat,
    quality,
    pngCompressionLevel,
    keepMetadata,
  };
}

export function parseStoredCompressionSettings(raw: string): CompressionSettingsV1 | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CompressionSettingsV1>;
    return normalizeCompressionSettings(parsed);
  } catch {
    return null;
  }
}

export async function loadDefaultCompressionSettings(): Promise<CompressionSettingsV1 | null> {
  const raw = await LocalStorage.getItem<string>(DEFAULT_SETTINGS_STORAGE_KEY);
  if (!raw) return null;
  return parseStoredCompressionSettings(raw);
}

export async function saveDefaultCompressionSettings(settings: CompressionSettingsV1): Promise<void> {
  const normalized = normalizeCompressionSettings(settings);
  await LocalStorage.setItem(DEFAULT_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
}
