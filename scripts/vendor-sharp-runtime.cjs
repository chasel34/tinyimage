#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = process.cwd();
const nodeModulesRoot = path.join(projectRoot, "node_modules");
const vendorRoot = path.join(projectRoot, "assets", "vendor-sharp");
const vendorNodeModulesRoot = path.join(vendorRoot, "node_modules");

function exists(p) {
  return fs.existsSync(p);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyDir(source, destination) {
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function copyPackage(packageName) {
  const sourcePath = path.join(nodeModulesRoot, ...packageName.split("/"));
  if (!exists(sourcePath)) {
    return false;
  }
  const destinationPath = path.join(vendorNodeModulesRoot, ...packageName.split("/"));
  ensureDir(path.dirname(destinationPath));
  copyDir(sourcePath, destinationPath);
  return true;
}

function listInstalledSharpRuntimePackages() {
  const imgDir = path.join(nodeModulesRoot, "@img");
  if (!exists(imgDir)) return [];

  return fs
    .readdirSync(imgDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^sharp-(?!libvips-dev)(?:darwin|linux|win32|wasm32)/.test(name) || /^sharp-libvips-(?!dev)/.test(name))
    .map((name) => `@img/${name}`);
}

function main() {
  if (!exists(path.join(nodeModulesRoot, "sharp"))) {
    console.warn("[vendor-sharp] sharp is not installed yet, skip vendoring");
    return;
  }

  fs.rmSync(vendorRoot, { recursive: true, force: true });
  ensureDir(vendorNodeModulesRoot);

  const basePackages = ["sharp", "detect-libc", "semver", "@img/colour"];
  const runtimePackages = listInstalledSharpRuntimePackages();
  const packagesToCopy = [...new Set([...basePackages, ...runtimePackages])];

  const copied = [];
  for (const packageName of packagesToCopy) {
    if (copyPackage(packageName)) {
      copied.push(packageName);
    }
  }

  fs.writeFileSync(
    path.join(vendorRoot, "package.json"),
    JSON.stringify({ name: "vendor-sharp-runtime", private: true }, null, 2) + "\n",
    "utf8",
  );

  console.log(`[vendor-sharp] copied ${copied.length} packages to ${path.relative(projectRoot, vendorRoot)}`);
}

main();
