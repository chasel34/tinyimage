# TinyImage Changelog

## [1.0.0] - 2026-02-26

- Added Finder-based batch image compression for selected files on macOS
- Added support for keeping original format or converting to JPEG / PNG / WebP / AVIF
- Added per-file processing list with compute/write status, output size, and size change percentage
- Added batch write and single-item write actions
- Added default settings command and persisted compression preferences
- Added safe file writing flow with conflict auto-rename and overwrite/convert handling
- Added `sharp` runtime vendoring workaround for Raycast runtime compatibility
