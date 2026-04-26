# Architecture

## Runtime Shape

The app is an Electron 40 desktop tool for translating RPG Maker MV/MZ and Wolf RPG Editor projects.

- `main.ts` boots the Electron main process and registers IPC handlers.
- `src/ipc/` owns window lifecycle and renderer-to-main actions.
- `src/renderer/` is a Vue 3 SPA loaded through hash routes.
- `src/ts/rpgmv/` contains the MV/MZ extract, translate, apply, and verify pipeline.
- `src/ts/wolf/` contains the Wolf RPG extract/apply pipeline.
- `src/ts/libs/` contains shared translation, provider, file, and validation utilities.

## Core Translation Flow

### MV/MZ

1. Extract reads game `data/*.json`.
2. Extract writes `.txt` plus `.extracteddata`.
3. Translate reads extracted `.txt` files and calls the active provider.
4. Compare/verify expose structure and quality review tools.
5. Apply writes translated content back into JSON under `Completed/data` or in-place.

### Wolf

Wolf follows a parallel flow, but the extract/apply stages operate on Wolf-specific binary formats and text caches.

## Main Process Boundaries

- `src/ipc/windowManager.ts`: main window, route loading, global settings bootstrap
- `src/ipc/translateHandler.ts`: LLM settings, bulk translation, retranslate actions
- `src/ipc/toolsHandler.ts`: compare window, JSON verify window, verify-side LLM repair
- `src/ipc/settingsHandler.ts`: settings persistence and renderer-safe settings payloads
- `src/preload.ts`: channel whitelist and secure bridge APIs

## Renderer Surfaces

- `HomePage.vue`: entry landing page
- `MvMzPage.vue` and `WolfPage.vue`: main operator screens
- `LlmSettingsPage.vue`: translation-launch window
- `LlmComparePage.vue`: block mismatch and untranslated review
- `JsonVerifyPage.vue`: structural verification, repair, and LLM shift repair

## Harness Boundaries

Harnesses should validate production code through these layers:

- deterministic library and workflow checks against compiled main-process modules
- fixture-driven evals that score structure and repair behavior
- Electron UI smoke harnesses that inspect real windows and filesystem outputs

The harness should not replace the production code path with a parallel implementation.
