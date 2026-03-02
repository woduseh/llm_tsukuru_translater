(() => {
    const { ipcRenderer } = require('electron');
    const fs = require('fs');
    const path = require('path');

    const SEP_RE = /^---\s*\d+\s*---$/;

    interface FileEntry {
        name: string;
        origPath: string;
        transPath: string;
        mismatch: boolean;
        untranslated: boolean;
    }

    let dataDir = '';
    let files: FileEntry[] = [];
    let currentIdx = 0;
    let dirty: { [name: string]: boolean } = {};
    let selectedBlocks: Set<number> = new Set();

    function loadFiles(dir: string) {
        dataDir = dir;
        // Detect Wolf RPG vs RPG Maker extract path
        const wolfExtractDir = path.join(dir, '_Extract', 'Texts');
        const wolfBackupDir = wolfExtractDir + '_backup';
        const mvExtractDir = path.join(dir, 'Extract');
        const mvBackupDir = mvExtractDir + '_backup';

        let extractDir: string;
        let backupDir: string;
        if (fs.existsSync(wolfExtractDir) && fs.existsSync(wolfBackupDir)) {
            extractDir = wolfExtractDir;
            backupDir = wolfBackupDir;
        } else {
            extractDir = mvExtractDir;
            backupDir = mvBackupDir;
        }
        files = [];
        dirty = {};

        if (!fs.existsSync(extractDir) || !fs.existsSync(backupDir)) {
            document.getElementById('summary').innerHTML =
                '<span class="summary-error">Extract 또는 Extract_backup 폴더가 없습니다.</span>';
            return;
        }

        const transFiles: string[] = fs.readdirSync(extractDir).filter((f: string) => f.endsWith('.txt'));
        for (const name of transFiles) {
            const origPath = path.join(backupDir, name);
            const transPath = path.join(extractDir, name);
            if (!fs.existsSync(origPath)) continue;
            const origContent = fs.readFileSync(origPath, 'utf-8');
            const transContent = fs.readFileSync(transPath, 'utf-8');
            const origLines = origContent.split('\n');
            const transLines = transContent.split('\n');
            const mismatch = checkMismatch(origLines, transLines);
            const untranslated = origContent === transContent;
            files.push({ name, origPath, transPath, mismatch, untranslated });
        }

        currentIdx = 0;
        selectedBlocks = new Set();
        updateSelectionUI();
        renderSummary();
        renderFileList();
        renderBlocks();
    }

    function checkMismatch(origLines: string[], transLines: string[]): boolean {
        // Check if block structure matches between original and translated
        const origBlocks = splitBlocks(origLines);
        const transBlocks = splitBlocks(transLines);
        if (origBlocks.length !== transBlocks.length) return true;
        for (let i = 0; i < origBlocks.length; i++) {
            if (origBlocks[i].sep !== transBlocks[i].sep) return true;
            if (origBlocks[i].lines.length !== transBlocks[i].lines.length) return true;
        }
        return false;
    }

    function splitBlocks(lines: string[]): { sep: string; lines: string[] }[] {
        const blocks: { sep: string; lines: string[] }[] = [];
        let curSep = '';
        let curLines: string[] = [];
        for (const line of lines) {
            if (SEP_RE.test(line.trim())) {
                if (curSep || curLines.length > 0) {
                    blocks.push({ sep: curSep, lines: [...curLines] });
                }
                curSep = line;
                curLines = [];
            } else {
                curLines.push(line);
            }
        }
        if (curSep || curLines.length > 0) {
            blocks.push({ sep: curSep, lines: curLines });
        }
        return blocks;
    }

    function renderSummary() {
        const el = document.getElementById('summary');
        const mismatchCount = files.filter(f => f.mismatch).length;
        const untranslatedCount = files.filter(f => f.untranslated).length;
        if (files.length === 0) {
            el.innerHTML = '<span class="summary-error">비교할 파일이 없습니다.</span>';
        } else {
            const parts: string[] = [];
            if (mismatchCount > 0) {
                parts.push(`<span class="summary-error">⚠ ${mismatchCount}개 줄 수 불일치</span>`);
            }
            if (untranslatedCount > 0) {
                parts.push(`<span class="summary-warn">● ${untranslatedCount}개 미번역</span>`);
            }
            if (parts.length === 0) {
                el.innerHTML = `<span class="summary-ok">✓ 모든 파일 번역 완료, 블록 구조 일치 (${files.length}개 파일)</span>`;
            } else {
                el.innerHTML = `${parts.join(' &nbsp; ')} <span class="summary-total">(전체 ${files.length}개)</span>`;
            }
        }
    }

    function getFilteredFiles(): { file: FileEntry; realIdx: number }[] {
        const query = (document.getElementById('file-search') as HTMLInputElement).value.toLowerCase();
        const mismatchOnly = (document.getElementById('filter-mismatch') as HTMLInputElement).checked;
        const untranslatedOnly = (document.getElementById('filter-untranslated') as HTMLInputElement).checked;
        const result: { file: FileEntry; realIdx: number }[] = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (query && !f.name.toLowerCase().includes(query)) continue;
            if (mismatchOnly && !f.mismatch) continue;
            if (untranslatedOnly && !f.untranslated) continue;
            result.push({ file: f, realIdx: i });
        }
        return result;
    }

    function renderFileList() {
        const list = document.getElementById('file-list');
        list.innerHTML = '';
        const filtered = getFilteredFiles();

        document.getElementById('file-count').textContent = `${filtered.length}/${files.length}`;

        for (const { file, realIdx } of filtered) {
            const item = document.createElement('div');
            item.className = 'file-item' + (realIdx === currentIdx ? ' active' : '');
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = file.name;
            item.appendChild(nameSpan);

            if (dirty[file.name]) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-dirty';
                badge.textContent = '수정됨';
                item.appendChild(badge);
            }
            if (file.mismatch) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-error';
                badge.textContent = '불일치';
                item.appendChild(badge);
            }
            if (file.untranslated) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-untranslated';
                badge.textContent = '미번역';
                item.appendChild(badge);
            }

            item.onclick = () => {
                currentIdx = realIdx;
                renderFileList();
                renderBlocks();
            };
            list.appendChild(item);
        }

        // Scroll active item into view
        const active = list.querySelector('.file-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function autoResizeTextarea(textarea: HTMLTextAreaElement) {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    function syncBlockHeights() {
        const origContainer = document.getElementById('original-blocks');
        const transContainer = document.getElementById('translated-blocks');
        const origBlocks = origContainer.querySelectorAll(':scope > .block') as NodeListOf<HTMLElement>;
        const transBlocks = transContainer.querySelectorAll(':scope > .block') as NodeListOf<HTMLElement>;
        const len = Math.min(origBlocks.length, transBlocks.length);

        // Reset
        for (let i = 0; i < len; i++) {
            origBlocks[i].style.minHeight = '';
            transBlocks[i].style.minHeight = '';
        }

        // Equalize each pair
        for (let i = 0; i < len; i++) {
            const maxH = Math.max(origBlocks[i].offsetHeight, transBlocks[i].offsetHeight);
            origBlocks[i].style.minHeight = `${maxH}px`;
            transBlocks[i].style.minHeight = `${maxH}px`;
        }
    }

    function renderBlocks() {
        const origContainer = document.getElementById('original-blocks');
        const transContainer = document.getElementById('translated-blocks');
        origContainer.innerHTML = '';
        transContainer.innerHTML = '';
        selectedBlocks = new Set();
        updateSelectionUI();

        if (files.length === 0) return;

        const f = files[currentIdx];
        const origLines = fs.readFileSync(f.origPath, 'utf-8').split('\n');
        const transLines = fs.readFileSync(f.transPath, 'utf-8').split('\n');
        const origBlocks = splitBlocks(origLines);
        const transBlocks = splitBlocks(transLines);
        const maxLen = Math.max(origBlocks.length, transBlocks.length);

        for (let i = 0; i < maxLen; i++) {
            const ob = origBlocks[i];
            const tb = transBlocks[i];

            let blockStatus = 'ok';
            if (!ob || !tb) {
                blockStatus = 'missing';
            } else if (ob.sep !== tb.sep) {
                blockStatus = 'error-sep';
            } else if (ob.lines.length !== tb.lines.length) {
                blockStatus = 'error-lines';
            }

            // Original side
            const origEl = document.createElement('div');
            origEl.className = `block ${blockStatus}`;
            if (ob) {
                // Selection checkbox
                const selBox = document.createElement('div');
                selBox.className = 'select-indicator';
                selBox.textContent = '✓';
                const blockIdx = i;
                selBox.onclick = (e) => {
                    e.stopPropagation();
                    toggleBlockSelection(blockIdx, origEl, transContainer);
                };
                origEl.appendChild(selBox);

                if (ob.sep) {
                    const sepEl = document.createElement('div');
                    sepEl.className = 'sep-label';
                    sepEl.textContent = ob.sep;
                    origEl.appendChild(sepEl);
                }
                const pre = document.createElement('pre');
                pre.textContent = ob.lines.join('\n');
                origEl.appendChild(pre);

                const lineCount = document.createElement('span');
                lineCount.className = 'line-count';
                lineCount.textContent = `${ob.lines.length}줄`;
                origEl.appendChild(lineCount);
            } else {
                origEl.textContent = '(블록 없음)';
                origEl.classList.add('empty-block');
            }
            origContainer.appendChild(origEl);

            // Translated side — editable textarea
            const transEl = document.createElement('div');
            transEl.className = `block ${blockStatus}`;
            transEl.dataset.blockIdx = String(i);
            if (tb) {
                if (tb.sep) {
                    const sepEl = document.createElement('div');
                    sepEl.className = 'sep-label';
                    sepEl.textContent = tb.sep;
                    transEl.appendChild(sepEl);
                }
                const textarea = document.createElement('textarea');
                textarea.className = 'block-editor';
                textarea.value = tb.lines.join('\n');
                textarea.rows = Math.max(ob ? ob.lines.length : tb.lines.length, 1);
                textarea.dataset.blockIdx = String(i);
                textarea.addEventListener('input', () => {
                    dirty[f.name] = true;
                    (document.getElementById('saveBtn') as HTMLButtonElement).disabled = false;
                    document.getElementById('save-status').textContent = '';
                    const newLineCount = textarea.value.split('\n').length;
                    const countEl = transEl.querySelector('.line-count') as HTMLElement;
                    if (countEl) countEl.textContent = `${newLineCount}줄`;
                    const origLineCount = ob ? ob.lines.length : 0;
                    const newStatus = newLineCount !== origLineCount ? 'error-lines' : 'ok';
                    transEl.className = `block ${newStatus}${selectedBlocks.has(i) ? ' selected' : ''}`;
                    transEl.dataset.blockIdx = String(i);
                    origEl.className = `block ${newStatus}${selectedBlocks.has(i) ? ' selected' : ''}`;
                    renderFileList();
                    autoResizeTextarea(textarea);
                    syncBlockHeights();
                });
                transEl.appendChild(textarea);

                const lineCount = document.createElement('span');
                lineCount.className = 'line-count';
                const tbCount = tb.lines.length;
                lineCount.textContent = `${tbCount}줄`;
                transEl.appendChild(lineCount);
            } else {
                transEl.textContent = '(블록 없음)';
                transEl.classList.add('empty-block');
            }
            transContainer.appendChild(transEl);
        }

        requestAnimationFrame(() => {
            const textareas = transContainer.querySelectorAll('.block-editor') as NodeListOf<HTMLTextAreaElement>;
            for (const ta of textareas) autoResizeTextarea(ta);
            syncBlockHeights();
        });

        let syncing = false;
        origContainer.onscroll = () => {
            if (syncing) return;
            syncing = true;
            transContainer.scrollTop = origContainer.scrollTop;
            syncing = false;
        };
        transContainer.onscroll = () => {
            if (syncing) return;
            syncing = true;
            origContainer.scrollTop = transContainer.scrollTop;
            syncing = false;
        };
    }

    function toggleBlockSelection(blockIdx: number, origEl: HTMLElement, transContainer: HTMLElement) {
        if (selectedBlocks.has(blockIdx)) {
            selectedBlocks.delete(blockIdx);
            origEl.classList.remove('selected');
            const transBlock = transContainer.querySelector(`.block[data-block-idx="${blockIdx}"]`) as HTMLElement;
            if (transBlock) transBlock.classList.remove('selected');
        } else {
            selectedBlocks.add(blockIdx);
            origEl.classList.add('selected');
            const transBlock = transContainer.querySelector(`.block[data-block-idx="${blockIdx}"]`) as HTMLElement;
            if (transBlock) transBlock.classList.add('selected');
        }
        updateSelectionUI();
    }

    function updateSelectionUI() {
        const count = selectedBlocks.size;
        const countEl = document.getElementById('selection-count');
        const selBtn = document.getElementById('retranslateSelBtn') as HTMLButtonElement;
        if (count > 0) {
            countEl.textContent = `${count}개 블록 선택`;
            selBtn.disabled = false;
        } else {
            countEl.textContent = '';
            selBtn.disabled = true;
        }
    }

    function saveCurrentFile() {
        if (files.length === 0) return;
        const f = files[currentIdx];
        const transLines = fs.readFileSync(f.transPath, 'utf-8').split('\n');
        const transBlocks = splitBlocks(transLines);

        // Collect edited blocks from textareas
        const textareas = document.querySelectorAll('#translated-blocks .block-editor') as NodeListOf<HTMLTextAreaElement>;
        for (const ta of textareas) {
            const idx = parseInt(ta.dataset.blockIdx, 10);
            if (idx < transBlocks.length) {
                transBlocks[idx].lines = ta.value.split('\n');
            }
        }

        // Reassemble and write
        const parts: string[] = [];
        for (const block of transBlocks) {
            if (block.sep) parts.push(block.sep);
            parts.push(...block.lines);
        }
        fs.writeFileSync(f.transPath, parts.join('\n'), 'utf-8');

        // Recheck mismatch
        const origLines = fs.readFileSync(f.origPath, 'utf-8').split('\n');
        const newTransLines = fs.readFileSync(f.transPath, 'utf-8').split('\n');
        f.mismatch = checkMismatch(origLines, newTransLines);
        f.untranslated = fs.readFileSync(f.origPath, 'utf-8') === fs.readFileSync(f.transPath, 'utf-8');
        dirty[f.name] = false;

        (document.getElementById('saveBtn') as HTMLButtonElement).disabled = true;
        document.getElementById('save-status').textContent = '저장됨 ✓';
        renderSummary();
        renderFileList();
        renderBlocks();
    }

    ipcRenderer.on('initCompare', (_ev: any, dir: string) => {
        loadFiles(dir);
        (document.getElementById('retranslateBtn') as HTMLButtonElement).disabled = false;
    });

    ipcRenderer.on('retranslateProgress', (_ev: any, msg: string) => {
        document.getElementById('save-status').textContent = `🔄 ${msg}`;
    });

    ipcRenderer.on('retranslateFileDone', (_ev: any, result: { success: boolean; error?: string }) => {
        const btn = document.getElementById('retranslateBtn') as HTMLButtonElement;
        btn.disabled = false;
        btn.textContent = '전체 재번역';
        if (result.success) {
            document.getElementById('save-status').textContent = '재번역 완료 ✓';
            const f = files[currentIdx];
            const origContent = fs.readFileSync(f.origPath, 'utf-8');
            const transContent = fs.readFileSync(f.transPath, 'utf-8');
            const origLines = origContent.split('\n');
            const transLines = transContent.split('\n');
            f.mismatch = checkMismatch(origLines, transLines);
            f.untranslated = origContent === transContent;
            dirty[f.name] = false;
            renderSummary();
            renderFileList();
            renderBlocks();
        } else {
            document.getElementById('save-status').textContent = `❌ ${result.error || '번역 실패'}`;
        }
    });

    ipcRenderer.on('retranslateBlocksDone', (_ev: any, result: { success: boolean; error?: string }) => {
        const btn = document.getElementById('retranslateSelBtn') as HTMLButtonElement;
        btn.disabled = false;
        btn.textContent = '선택 블록 재번역';
        if (result.success) {
            document.getElementById('save-status').textContent = `${selectedBlocks.size}개 블록 재번역 완료 ✓`;
            const f = files[currentIdx];
            const origContent = fs.readFileSync(f.origPath, 'utf-8');
            const transContent = fs.readFileSync(f.transPath, 'utf-8');
            const origLines = origContent.split('\n');
            const transLines = transContent.split('\n');
            f.mismatch = checkMismatch(origLines, transLines);
            f.untranslated = origContent === transContent;
            dirty[f.name] = false;
            renderSummary();
            renderFileList();
            renderBlocks();
        } else {
            document.getElementById('save-status').textContent = `❌ ${result.error || '번역 실패'}`;
        }
    });

    // Search & filter events
    document.getElementById('file-search').addEventListener('input', () => renderFileList());
    document.getElementById('filter-mismatch').addEventListener('change', () => renderFileList());
    document.getElementById('filter-untranslated').addEventListener('change', () => renderFileList());

    // ── Navigation: next/prev mismatch/untranslated file ──
    function navigateToFile(direction: 1 | -1) {
        if (files.length === 0) return;
        const start = currentIdx + direction;
        const len = files.length;
        for (let i = 0; i < len; i++) {
            const idx = ((start + direction * i) % len + len) % len;
            if (files[idx].mismatch || files[idx].untranslated) {
                currentIdx = idx;
                renderFileList();
                renderBlocks();
                return;
            }
        }
    }

    document.getElementById('prevMismatchFileBtn').onclick = () => navigateToFile(-1);
    document.getElementById('nextMismatchFileBtn').onclick = () => navigateToFile(1);

    // ── Navigation: next/prev mismatch block within current file ──
    function navigateToBlock(direction: 1 | -1) {
        const origContainer = document.getElementById('original-blocks');
        const blocks = origContainer.querySelectorAll('.block') as NodeListOf<HTMLElement>;
        if (blocks.length === 0) return;

        // Find all mismatch block indices
        const mismatchIndices: number[] = [];
        blocks.forEach((block, i) => {
            if (block.classList.contains('error-lines') || block.classList.contains('error-sep') || block.classList.contains('missing')) {
                mismatchIndices.push(i);
            }
        });
        if (mismatchIndices.length === 0) return;

        // Find current scroll position's closest visible block
        const scrollTop = origContainer.scrollTop;
        const containerTop = origContainer.getBoundingClientRect().top;
        let currentBlockIdx = 0;
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].offsetTop <= scrollTop + 10) {
                currentBlockIdx = i;
            }
        }

        // Find next/prev mismatch from current position
        let target = -1;
        if (direction === 1) {
            for (const idx of mismatchIndices) {
                if (idx > currentBlockIdx) { target = idx; break; }
            }
            if (target === -1) target = mismatchIndices[0]; // wrap
        } else {
            for (let i = mismatchIndices.length - 1; i >= 0; i--) {
                if (mismatchIndices[i] < currentBlockIdx) { target = mismatchIndices[i]; break; }
            }
            if (target === -1) target = mismatchIndices[mismatchIndices.length - 1]; // wrap
        }

        if (target >= 0 && target < blocks.length) {
            // Manually scroll container to center the target block
            const targetTop = blocks[target].offsetTop - origContainer.offsetTop;
            const centered = targetTop - origContainer.clientHeight / 2 + blocks[target].offsetHeight / 2;
            origContainer.scrollTo({ top: centered, behavior: 'smooth' });

            // Also scroll translated side in sync
            const transContainer = document.getElementById('translated-blocks');
            const transBlocks = transContainer.querySelectorAll('.block') as NodeListOf<HTMLElement>;
            if (transBlocks[target]) {
                const tTop = transBlocks[target].offsetTop - transContainer.offsetTop;
                const tCentered = tTop - transContainer.clientHeight / 2 + transBlocks[target].offsetHeight / 2;
                transContainer.scrollTo({ top: tCentered, behavior: 'smooth' });
            }

            // Flash highlight
            blocks[target].style.outline = '2px solid #ff79c6';
            setTimeout(() => { blocks[target].style.outline = ''; }, 1500);
        }
    }

    document.getElementById('prevMismatchBlockBtn').onclick = () => navigateToBlock(-1);
    document.getElementById('nextMismatchBlockBtn').onclick = () => navigateToBlock(1);

    document.getElementById('saveBtn').onclick = () => saveCurrentFile();

    document.getElementById('retranslateBtn').onclick = () => {
        if (files.length === 0 || !dataDir) return;
        const f = files[currentIdx];
        const btn = document.getElementById('retranslateBtn') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = '번역 중...';
        document.getElementById('save-status').textContent = '🔄 준비 중...';
        ipcRenderer.send('retranslateFile', { dir: dataDir, fileName: f.name });
    };

    document.getElementById('retranslateSelBtn').onclick = () => {
        if (files.length === 0 || !dataDir || selectedBlocks.size === 0) return;
        const f = files[currentIdx];
        const btn = document.getElementById('retranslateSelBtn') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = '번역 중...';
        document.getElementById('save-status').textContent = '🔄 준비 중...';
        const indices = Array.from(selectedBlocks).sort((a, b) => a - b);
        ipcRenderer.send('retranslateBlocks', { dir: dataDir, fileName: f.name, blockIndices: indices });
    };

    document.getElementById('closeBtn').onclick = () => {
        window.close();
    };

    // Ctrl+S to save
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveCurrentFile();
        }
    });
})();
