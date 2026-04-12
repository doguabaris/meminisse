# Changelog

## 0.4.0 / 2026-04-12

* Added a deterministic local benchmark suite for recall quality, lifecycle safety, and review signals.

* Added `npm run benchmark` with text and JSON output.

* Added optional Codex model-backed benchmark measurement with answer and citation accuracy.

## 0.3.0 / 2026-04-12

* Added `meminisse install --local` as the preferred local Codex install command.

* Removed the legacy `meminisse-install-home` binary and installer script.

* Added `meminisse doctor` for local installation and storage health checks.

* Added `meminisse review` for stale memories, duplicate records, and broken path references.

* Added recall telemetry with `recall_count` and `last_recalled_at`.

* Added `meminisse status --verbose` for status and kind breakdowns.

* Added `meminisse attach` for copying support files into `.meminisse/attachments` and remembering their paths.

## 0.2.0 / 2026-04-12

* Added `meminisse list` for inspecting memory records without a recall query.

* Added `meminisse forget` for soft-deleting active memories by ID while keeping JSONL history inspectable.

## 0.1.1 / 2026-04-12

* Fixed Codacy/JSHint loop-function warning in memory lifecycle updates.

## 0.1.0 / 2026-04-12

* Initial release
