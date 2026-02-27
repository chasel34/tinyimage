import { access } from "node:fs/promises";
import path from "node:path";
import { CompressionSettingsV1, TargetFormat } from "../types";

export const SUPPORTED_INPUT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

export function normalizeExtension(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return ext ? ext : null;
}

export function isSupportedInputExtension(ext: string | null): boolean {
  return Boolean(ext && SUPPORTED_INPUT_EXTENSIONS.has(ext));
}

export function inferSourceFormatFromExtension(ext: string | null): TargetFormat | null {
  if (!ext) return null;
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".png") return "png";
  if (ext === ".webp") return "webp";
  if (ext === ".avif") return "avif";
  return null;
}

export function targetFormatToCanonicalExtension(format: TargetFormat): string {
  switch (format) {
    case "jpeg":
      return ".jpg";
    case "png":
      return ".png";
    case "webp":
      return ".webp";
    case "avif":
      return ".avif";
  }
}

function extForGenerateNew(
  settings: CompressionSettingsV1,
  outputFormat: TargetFormat,
  sourceExtLower: string | null,
): string {
  if (settings.formatMode === "keep-original" && sourceExtLower && isSupportedInputExtension(sourceExtLower)) {
    return sourceExtLower;
  }
  return targetFormatToCanonicalExtension(outputFormat);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findAvailablePath(basePath: string, options?: { exclude?: string[] }): Promise<string> {
  const excluded = new Set((options?.exclude ?? []).map((p) => path.resolve(p)));
  const resolvedBase = path.resolve(basePath);

  if (!excluded.has(resolvedBase) && !(await pathExists(basePath))) {
    return basePath;
  }

  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const stem = path.basename(basePath, ext);

  for (let index = 1; index < 10_000; index += 1) {
    const candidate = path.join(dir, `${stem}-${index}${ext}`);
    const resolvedCandidate = path.resolve(candidate);
    if (excluded.has(resolvedCandidate)) continue;
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error("Unable to generate an available output file name");
}

export function resolveOutputFormat(
  sourceExtLower: string | null,
  settings: CompressionSettingsV1,
): TargetFormat | null {
  if (settings.formatMode === "convert") return settings.targetFormat;
  return inferSourceFormatFromExtension(sourceExtLower);
}

export interface OutputPathPlan {
  finalPath: string;
  overwriteDeletesSourceAfterWrite: boolean;
}

export async function resolveOutputPathPlan(
  sourcePath: string,
  sourceExtLower: string | null,
  settings: CompressionSettingsV1,
  outputFormat: TargetFormat,
): Promise<OutputPathPlan> {
  const sourceFormat = inferSourceFormatFromExtension(sourceExtLower);
  const dir = path.dirname(sourcePath);
  const sourceBaseName = path.basename(sourcePath, path.extname(sourcePath));

  if (settings.outputMode === "generate-new") {
    const ext = extForGenerateNew(settings, outputFormat, sourceExtLower);
    const requested = path.join(dir, `${sourceBaseName}.tiny${ext}`);
    const finalPath = await findAvailablePath(requested, { exclude: [sourcePath] });
    return { finalPath, overwriteDeletesSourceAfterWrite: false };
  }

  if (settings.formatMode === "keep-original" || sourceFormat === outputFormat) {
    return { finalPath: sourcePath, overwriteDeletesSourceAfterWrite: false };
  }

  const ext = targetFormatToCanonicalExtension(outputFormat);
  const requested = path.join(dir, `${sourceBaseName}${ext}`);
  const finalPath =
    path.resolve(requested) === path.resolve(sourcePath)
      ? sourcePath
      : await findAvailablePath(requested, { exclude: [sourcePath] });

  return {
    finalPath,
    overwriteDeletesSourceAfterWrite: path.resolve(finalPath) !== path.resolve(sourcePath),
  };
}
