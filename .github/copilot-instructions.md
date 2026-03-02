# Copilot Instructions — Tsukuru Extractor

## Project Overview

Electron desktop app for extracting, translating, and applying text in RPG Maker MV/MZ and Wolf RPG Editor games. The primary UI language is Korean; code comments and variable names mix Korean, English, and Japanese.

## Build & Run

```bash
# Install dependencies
npm install

# Run in development (sets codepage to UTF-8, then launches Electron)
npm start

# Build Windows portable/installer
npm run build        # x64 only
npm run build2       # all architectures
```

There is **no test suite or linter** configured. TypeScript is compiled implicitly by Electron at runtime — there is no separate `tsc` build step. The `.js` files alongside `.ts` files are the pre-compiled outputs checked into the repo.

## Architecture

### Dual-file Convention (`.ts` + `.js`)

Every TypeScript source file has a corresponding `.js` file committed alongside it. **When editing logic, modify the `.ts` file AND keep the `.js` file in sync.** The app's `main` entry point in `package.json` is `main.js` (compiled from `main.ts`).

### Process Model

- **Main process**: `main.ts` — Electron entry point; registers all `ipcMain` handlers, creates windows, orchestrates extract/apply/translate flows.
- **Renderer processes**: HTML pages in `src/html/` with inline `rend.ts`/`rend.js` scripts using `ipcRenderer`. `nodeIntegration: true`, no context isolation.

### RPG Maker MV/MZ Pipeline (`src/js/rpgmv/`)

The core workflow is **Extract → Translate → Apply**:

1. **Extract** (`extract.ts`): Reads JSON data files from the game's `data/` folder, walks the RPG Maker data structures (maps, events, actors, items, system, etc.), and produces:
   - `.txt` files in `data/Extract/` — one per source JSON, containing extracted text line-by-line
   - `.extracteddata` — a zlib-compressed JSON metadata file (via `edtool.ts`) that maps each line number in the `.txt` file back to its JSON path in the original data

2. **Translate** (`translator.ts` + `libs/geminiTranslator.ts`): Translates the `.txt` files using Gemini LLM API. Maintains backup, progress, and cache files in the Extract folder.

3. **Apply** (`apply.ts`): Reads the (translated) `.txt` files and `.extracteddata` metadata, then reconstructs the original JSON files with translated values replacing originals. Outputs to `data/Completed/data/` or directly overwrites via "instant apply."

### Key Data Structures in `.extracteddata`

The metadata stores per-file entries keyed by **line number** (the starting line in the `.txt` file):
```
data[lineNumber] = {
  val: "dotted.json.path",   // path into the original JSON (e.g., "events.3.pages.0.list.5.parameters.0")
  m: endLineNumber,          // exclusive end line — text spans lines [lineNumber, m)
  origin: "SourceFile.json", // which JSON file this entry came from
  conf: { type, code, ... }  // extraction config metadata
}
```

The `.txt` line range `[lineNumber, m)` must have exactly the same number of lines in the translated file as in the original for apply to work correctly. Multi-line text entries (e.g., dialogue with `\n`) span multiple lines.

### Wolf RPG Editor Pipeline (`src/js/wolf/`)

Separate but parallel pipeline:
- **Parser** (`parser/`): Binary parser for Wolf RPG `.wolf` data files
- **Extract** (`extract/`): Extracts strings from parsed data, produces text files in `_Extract/Texts/`
- **Apply** (`apply/`): Reads translated text files and patches binary data back

### Shared Utilities

- `src/js/libs/projectTools.ts` — Singleton for sending IPC messages to renderer
- `src/js/rpgmv/globalutils.ts` — `checkIsMapFile()`, `sleep()`
- `src/js/rpgmv/datas.ts` — Constants: file-type mappings (`onebyone`), ignore lists, settings defaults, beautify codes
- `src/js/rpgmv/edtool.ts` — Read/write `.extracteddata` (zlib + JSON)
- `src/js/rpgmv/fileCrypto.ts` — RPG Maker asset encryption/decryption
- `src/utils.ts` — Encoding helpers, directory traversal
- `globals.d.ts` — Global type declarations for `globalThis` properties

### Global State

Extensive use of `globalThis` for shared state:
- `globalThis.gb` — In-memory extraction data (populated during extract, consumed during format)
- `globalThis.settings` — User settings (persisted via `electron-store`)
- `globalThis.mwindow` — Main BrowserWindow reference
- `globalThis.WolfExtData`, `WolfEncoding`, `WolfMetadata`, `WolfCache` — Wolf RPG state

## Key Conventions

- **Line-number alignment is critical**: The extract/apply pipeline relies on `.txt` line numbers matching `.extracteddata` metadata exactly. Any off-by-one error causes text to shift to wrong dialogue entries.
- **`setObj` / `returnVal`**: Dot-path based JSON accessors (e.g., `"events.3.pages.0.list.5.parameters.0"`) used to get/set deeply nested values in RPG Maker JSON.
- **Map file detection**: Files matching `Map###.json` pattern are treated as map files with event extraction logic.
- **BOM handling**: UTF-8 BOM (`0xFEFF`) is stripped on read in multiple places — be consistent.
- **IPC pattern**: Main process registers `ipcMain.on(channel, handler)`, renderers communicate via `ipcRenderer.send(channel, data)` / `ipcRenderer.on(channel, callback)`.
- **`onebyone` mapping** in `datas.ts` maps specific JSON filenames to their extraction type (actor, item, skill, etc.). Files not in this map and not map files go through generic `ex` extraction if enabled.
