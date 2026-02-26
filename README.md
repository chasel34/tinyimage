# TinyImage (Raycast Extension)

Compress and convert selected images from Finder in Raycast, powered by `sharp`.

## Features

- macOS only (Finder selection workflow)
- Batch process multiple selected images
- Keep original format or convert to `JPEG / PNG / WebP / AVIF`
- Show per-image compute/write status, output size, and size delta percentage
- Batch write and single-item write actions
- Output modes:
  - Generate new file (`.tiny` suffix, auto rename on conflicts)
  - Overwrite original (with confirmation for batch write)
- Separate command to edit default compression settings

## Commands

- `Compress Selected Images`
- `Open Compression Settings`

## Supported Input Formats

- `jpg`, `jpeg`, `png`, `webp`, `avif` (static images only)

## Development

### Install

```bash
npm install
```

`postinstall` will automatically vendor the `sharp` runtime into `assets/vendor-sharp`.

### Run in Raycast

```bash
npm run dev
```

### Checks

```bash
npm run lint
npm run build
```

## Why `assets/vendor-sharp` Exists

Raycast bundles commands into single JS files, but `sharp` requires platform-specific runtime binaries (`@img/*`). To make the extension run reliably in Raycast development/runtime, this project vendors the installed `sharp` runtime packages into `assets/vendor-sharp` and loads `sharp` from there at runtime.

Regenerate vendored runtime manually if needed:

```bash
npm run vendor-sharp
```

## Publish to Raycast

This repository is your source repository. Publishing to the Raycast Store is done via the Raycast CLI, which opens a PR against the official [`raycast/extensions`](https://github.com/raycast/extensions) repository.

```bash
npm run build
npm run publish
```

See the official docs:

- https://developers.raycast.com/basics/prepare-an-extension-for-store
- https://developers.raycast.com/basics/publish-an-extension
