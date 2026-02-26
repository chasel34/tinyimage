import { randomBytes } from "node:crypto";
import { unlink, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { mapFsOrSharpErrorToMessage } from "./format";
import { resolveOutputPathPlan } from "./pathing";
import { CompressionSettingsV1, ImageTaskItem, WriteResult } from "../types";

class DeleteSourceAfterWriteError extends Error {
  partialOutputPath: string;

  constructor(message: string, partialOutputPath: string) {
    super(message);
    this.name = "DeleteSourceAfterWriteError";
    this.partialOutputPath = partialOutputPath;
  }
}

function buildTempPath(targetPath: string): string {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const suffix = randomBytes(6).toString("hex");
  return path.join(dir, `.${base}.tinyimage-tmp-${process.pid}-${suffix}`);
}

async function writeViaTempFile(targetPath: string, buffer: Buffer): Promise<void> {
  const tempPath = buildTempPath(targetPath);

  try {
    await writeFile(tempPath, buffer);
    await rename(tempPath, targetPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup.
    }
    throw error;
  }
}

export async function writeComputedImageTask(
  item: ImageTaskItem,
  settings: CompressionSettingsV1,
): Promise<WriteResult> {
  if (!item.computed) {
    return { ok: false, errorMessage: "该图片尚未完成预计算，无法写入" };
  }

  try {
    const pathPlan = await resolveOutputPathPlan(
      item.currentSourcePath,
      item.sourceExtLower,
      settings,
      item.computed.outputFormat,
    );
    const outputPath = pathPlan.finalPath;

    await writeViaTempFile(outputPath, item.computed.buffer);

    if (pathPlan.overwriteDeletesSourceAfterWrite) {
      try {
        await unlink(item.currentSourcePath);
      } catch {
        throw new DeleteSourceAfterWriteError("已写入新文件，但删除原文件失败", outputPath);
      }
    }

    return {
      ok: true,
      outputPath,
      outputBytes: item.computed.outputBytes,
      nextCurrentSourcePath: settings.outputMode === "overwrite-original" ? outputPath : item.currentSourcePath,
    };
  } catch (error) {
    if (error instanceof DeleteSourceAfterWriteError) {
      return {
        ok: false,
        errorMessage: error.message,
        partialOutputPath: error.partialOutputPath,
      };
    }

    return {
      ok: false,
      errorMessage: mapFsOrSharpErrorToMessage(error, "写入失败（未知原因）"),
    };
  }
}
