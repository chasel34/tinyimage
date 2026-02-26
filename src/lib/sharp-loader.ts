import { environment } from "@raycast/api";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

type SharpFactory = (typeof import("sharp"))["default"];

let cachedSharpFactory: SharpFactory | null = null;

function normalizeSharpModule(mod: unknown): SharpFactory {
  const maybeDefault = (mod as { default?: unknown })?.default;
  return (maybeDefault ?? mod) as SharpFactory;
}

function loadSharpFromVendorAssets(): SharpFactory {
  const vendorPackageJsonPath = path.join(
    environment.assetsPath,
    "vendor-sharp",
    "node_modules",
    "sharp",
    "package.json",
  );
  if (!existsSync(vendorPackageJsonPath)) {
    throw new Error("未找到 vendored sharp runtime（assets/vendor-sharp）");
  }

  const vendorRequire = createRequire(vendorPackageJsonPath);
  return normalizeSharpModule(vendorRequire("sharp"));
}

function loadSharpFromLocalNodeModules(): SharpFactory {
  const localRequire = createRequire(path.join(process.cwd(), "package.json"));
  return normalizeSharpModule(localRequire("sharp"));
}

export async function loadSharp(): Promise<SharpFactory> {
  if (cachedSharpFactory) return cachedSharpFactory;

  try {
    cachedSharpFactory = loadSharpFromVendorAssets();
    return cachedSharpFactory;
  } catch (vendorError) {
    try {
      cachedSharpFactory = loadSharpFromLocalNodeModules();
      return cachedSharpFactory;
    } catch (localError) {
      const vendorMessage = vendorError instanceof Error ? vendorError.message : String(vendorError);
      const localMessage = localError instanceof Error ? localError.message : String(localError);
      throw new Error(
        `无法加载 sharp 运行时。请执行 npm install（会自动生成 assets/vendor-sharp）。vendor: ${vendorMessage}; local: ${localMessage}`,
      );
    }
  }
}
