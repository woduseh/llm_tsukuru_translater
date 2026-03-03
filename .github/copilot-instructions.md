# Copilot Instructions — Tsukuru Extractor

## Project Overview

Electron 40 desktop app (Windows) for extracting, translating, and applying text in RPG Maker MV/MZ and Wolf RPG Editor games. UI is Vue 3 SPA rendered via Vite; primary UI language is Korean. Code comments and variable names mix Korean, English, and Japanese.

## Build, Test, Lint

```bash
npm install
npm start                  # builds renderer (Vite), then launches Electron
npm run dev                # Vite dev server + Electron with HMR (parallel)
npm run build              # production build (Windows x64 portable + NSIS installer)
npm run build:renderer     # Vite build only → dist-renderer/
npm test                   # vitest run (all ~165 tests)
npx vitest run test/unit/edtool.test.ts          # single test file
npx vitest run -t "round-trip"                   # tests matching name pattern
npm run test:watch         # vitest in watch mode
npm run test:coverage      # vitest with v8 coverage
npm run lint               # eslint on src/**/*.ts and main.ts
npx tsc --noEmit           # type-check without emitting
```

## Architecture

### Dual-file Convention (`.ts` + `.js`) — CRITICAL

Main-process TypeScript files (`main.ts`, `src/ipc/*.ts`, `src/js/**/*.ts`, `src/utils.ts`, `src/appContext.ts`, `src/preload.ts`) each have a **committed `.js` companion** that is the actual file Electron runs.

The `prestart` and `prebuild` npm scripts automatically run `tsc`, which compiles `.ts` → `.js`. However, **the `.js` files are also committed to git** so that production builds work without a compile step.

**When editing any main-process `.ts` file, you MUST also update or regenerate the corresponding `.js` file.** Run `npx tsc` to regenerate all `.js` files, then use `git add -f` to stage them (they are gitignored by default: `/main.js`, `/src/ipc/**/*.js`, `/src/js/**/*.js`, `/src/preload.js`, etc.).

Main-process imports reference the `.js` extension explicitly (e.g., `import * as applyjs from "./src/js/rpgmv/apply.js"`).

This convention does NOT apply to renderer code (`src/renderer/**`) — those are Vue SFCs compiled by Vite.

### Two TypeScript Configs

- `tsconfig.json` — Main process (CommonJS, `target: ES2018`, `strict: true`). Excludes `src/renderer/`, `test/`, `dist-renderer/`.
- `tsconfig.renderer.json` — Renderer/Vite. Used by `vite.renderer.config.ts` for Vue SFC compilation.

### Process Model

```
main.ts (Electron main)
├── src/ipc/windowManager.ts    — BrowserWindow creation, loadRoute()
├── src/ipc/extractHandler.ts   — extract/apply IPC handlers
├── src/ipc/translateHandler.ts — LLM translate, settings, compare windows
├── src/ipc/toolsHandler.ts     — LLM compare, JSON verify, project convert
├── src/ipc/settingsHandler.ts  — settings window
├── src/ipc/shared.ts           — shared IPC utilities
└── src/ipc/viteHelper.ts       — loadRoute() for hash-based SPA routing

src/renderer/ (Vue 3 SPA, built by Vite → dist-renderer/)
├── router.ts                   — createWebHashHistory (required for file:// protocol)
├── views/MvMzPage.vue          — main RPG Maker page
├── views/WolfPage.vue          — Wolf RPG page
├── views/SettingsPage.vue      — settings
├── views/LlmSettingsPage.vue   — LLM translation config
├── views/LlmComparePage.vue    — translation comparison (sub-window)
├── views/JsonVerifyPage.vue    — JSON verification (sub-window)
└── views/HomePage.vue          — landing/home page

src/preload.ts — contextBridge with channel whitelists (SEND_CHANNELS, RECEIVE_CHANNELS)
```

### Renderer IPC Pattern

Vue components use the `useIpcOn(channel, callback)` composable from `src/renderer/composables/useIpc.ts`, which auto-removes listeners on component unmount. For one-shot sends, use `api.send()` from the same module.

### IPC Communication Pattern

- Renderer → Main: `window.api.send(channel, ...args)` — channels must be in `SEND_CHANNELS` whitelist in `src/preload.ts`
- Main → Renderer: `webContents.send(channel, ...args)` — channels must be in `RECEIVE_CHANNELS` whitelist
- **When adding a new IPC channel**, update both `SEND_CHANNELS`/`RECEIVE_CHANNELS` in `src/preload.ts` AND `src/preload.js`
- Main-process IPC bridge: `src/js/libs/projectTools.ts` wraps `appCtx.mainWindow.webContents.send()` — all backend-to-renderer messaging goes through `Tools.send()`, `Tools.sendAlert()`, `Tools.sendError()`, `Tools.worked()`

### Sub-window Ready-signal Pattern

Sub-windows (LLM Compare, JSON Verify, LLM Settings) load the same Vue SPA at different hash routes. Because Vue Router lazy-loads route components, **`did-finish-load` fires before the Vue component mounts**. To avoid race conditions:

1. Main process stores pending data and only shows the window on `did-finish-load`
2. Vue component sends a ready signal (e.g., `api.send('compareReady')`) in `onMounted`
3. Main process responds with the pending data on receiving the ready signal

Follow this pattern for any new sub-window.

### Electron 40 Specifics

- `sandbox: false` is REQUIRED in all BrowserWindow `webPreferences` — Electron 40 defaults to `sandbox: true` when `contextIsolation: true`, which blocks Node.js modules in preload
- `webContents.send` loses `this` binding when stored as a standalone reference — always wrap in an arrow function

### RPG Maker MV/MZ Pipeline (`src/js/rpgmv/`)

Core workflow: **Extract → Translate → Apply**

1. **Extract** (`extract/`): Reads game `data/*.json` → produces `.txt` files + `.extracteddata` (zlib-compressed JSON metadata via `edtool.ts`)
2. **Translate** (`translator.ts` + `libs/geminiTranslator.ts`): Translates `.txt` via Gemini LLM API
3. **Apply** (`apply.ts`): Reads translated `.txt` + `.extracteddata` → reconstructs JSON with translations

### `.extracteddata` Structure

```
data[lineNumber] = {
  val: "dotted.json.path",   // e.g., "events.3.pages.0.list.5.parameters.0"
  m: endLineNumber,          // exclusive end — text spans lines [lineNumber, m)
  origin: "SourceFile.json",
  conf: { type, code, ... }
}
```

### Wolf RPG Editor Pipeline (`src/js/wolf/`)

Parallel pipeline with binary parser for `.wolf` data files, separate extract/apply logic.

### Global State

`src/appContext.ts` exports the `appCtx` singleton — the centralized state for the main process: `mainWindow`, `settingsWindow`, `settings`, `gb` (extraction data), `oPath`, `sourceDir`, `llmAbort`, Wolf RPG state (`WolfExtData`, `WolfCache`, `WolfMetadata`). Types declared in `globals.d.ts` and `src/types/settings.ts`.

### Logging

Main process uses `electron-log` (`src/logger.ts`). Import `log` from `'./src/logger'` — writes to file (info+) and console (debug+), 5 MB rotation.

## Key Conventions

- **Line-number alignment is critical**: Extract/apply pipeline relies on `.txt` line numbers matching `.extracteddata` metadata. Off-by-one errors shift text to wrong dialogue entries.
- **`setObj` / `returnVal`**: Dot-path based JSON accessors for deeply nested RPG Maker data structures.
- **Map file detection**: `Map###.json` pattern triggers event extraction logic.
- **BOM handling**: UTF-8 BOM (`0xFEFF`) is stripped on read — maintain consistency.
- **`onebyone` mapping** in `datas.ts`: Maps JSON filenames to extraction types. Files not mapped go through generic `ex` extraction.
- **Hash-based routing**: Vue Router uses `createWebHashHistory` — required for Electron `file://` protocol. All window routes use `#/path` format.
- **SweetAlert2 for dialogs**: Used throughout Vue components for user prompts. Dark theme CSS overrides are in `src/renderer/assets/global.css`.
- **Test fixtures are fragile**: PowerShell `Set-Content` can corrupt JSON fixtures via encoding changes. If fixtures show up in `git diff` unexpectedly, restore them with `git checkout test/fixtures/`.
