import { stat } from "node:fs/promises";
import type sharp from "sharp";
import { mapFsOrSharpErrorToMessage } from "./format";
import { resolveOutputFormat, resolveOutputPathPlan } from "./pathing";
import { loadSharp } from "./sharp-loader";
import { CompressionSettingsV1, ImageTaskItem, PrecomputeResult, TargetFormat } from "../types";

function applyEncoder(pipeline: sharp.Sharp, outputFormat: TargetFormat, settings: CompressionSettingsV1): sharp.Sharp {
  switch (outputFormat) {
    case "jpeg":
      return pipeline.jpeg({ quality: settings.quality });
    case "png":
      return pipeline.png({ compressionLevel: settings.pngCompressionLevel });
    case "webp":
      return pipeline.webp({ quality: settings.quality });
    case "avif":
      return pipeline.avif({ quality: settings.quality });
  }
}

export async function precomputeImageTask(
  item: ImageTaskItem,
  settings: CompressionSettingsV1,
): Promise<PrecomputeResult> {
  try {
    const sharp = await loadSharp();

    if (!item.sourceExtLower) {
      return { ok: false, errorMessage: "缺少文件扩展名，无法识别图片格式" };
    }

    const outputFormat = resolveOutputFormat(item.sourceExtLower, settings);
    if (!outputFormat) {
      return { ok: false, errorMessage: `不支持的格式: ${item.sourceExtLower}` };
    }

    const fileStat = await stat(item.currentSourcePath);
    if (!fileStat.isFile()) {
      return { ok: false, errorMessage: "不是文件，无法压缩" };
    }

    const sourceSizeBytes = fileStat.size;
    const metadata = await sharp(item.currentSourcePath).metadata();

    let pipeline = sharp(item.currentSourcePath).rotate();

    if (outputFormat === "jpeg" && metadata.hasAlpha) {
      pipeline = pipeline.flatten({ background: "#ffffff" });
    }

    if (settings.keepMetadata) {
      pipeline = pipeline.withMetadata();
    }

    pipeline = applyEncoder(pipeline, outputFormat, settings);
    const buffer = await pipeline.toBuffer();

    const pathPlan = await resolveOutputPathPlan(item.currentSourcePath, item.sourceExtLower, settings, outputFormat);

    return {
      ok: true,
      sourceSizeBytes,
      computed: {
        buffer,
        outputFormat,
        outputBytes: buffer.byteLength,
        plannedOutputPath: pathPlan.finalPath,
        overwriteDeletesSourceAfterWrite: pathPlan.overwriteDeletesSourceAfterWrite,
      },
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: mapFsOrSharpErrorToMessage(error, "压缩失败（未知原因）"),
    };
  }
}
