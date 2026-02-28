(() => {
    const { ipcRenderer } = require('electron');

    interface BlockValidation {
        index: number;
        separator: string;
        originalLines: string[];
        translatedLines: string[];
        lineCountMatch: boolean;
        separatorMatch: boolean;
    }

    interface FileValidation {
        fileIndex: number;
        fileName: string;
        blocks: BlockValidation[];
        hasError: boolean;
    }

    interface CompareData {
        files: FileValidation[];
        totalErrors: number;
        totalBlocks: number;
    }

    let compareData: CompareData = { files: [], totalErrors: 0, totalBlocks: 0 };
    let currentFileIndex = 0;

    function escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderSummary() {
        const summary = document.getElementById('summary');
        const errorFiles = compareData.files.filter(f => f.hasError).length;
        if (compareData.totalErrors === 0) {
            summary.innerHTML = `<span class="summary-ok">✓ 모든 블록이 정상적으로 검증되었습니다. (${compareData.files.length}개 파일, ${compareData.totalBlocks}개 블록)</span>`;
        } else {
            summary.innerHTML = `<span class="summary-error">⚠ ${compareData.totalErrors}개 오류 발견 (${errorFiles}/${compareData.files.length}개 파일에서)</span>`;
        }
    }

    function renderFileTabs() {
        const tabs = document.getElementById('file-tabs');
        tabs.innerHTML = '';
        for (let i = 0; i < compareData.files.length; i++) {
            const file = compareData.files[i];
            const tab = document.createElement('div');
            tab.className = 'file-tab' + (i === currentFileIndex ? ' active' : '') + (file.hasError ? ' has-error' : '');
            tab.textContent = file.fileName;
            tab.onclick = () => {
                currentFileIndex = i;
                renderFileTabs();
                renderBlocks();
            };
            tabs.appendChild(tab);
        }
    }

    function renderBlocks() {
        const origContainer = document.getElementById('original-blocks');
        const transContainer = document.getElementById('translated-blocks');
        origContainer.innerHTML = '';
        transContainer.innerHTML = '';

        if (compareData.files.length === 0) return;

        const file = compareData.files[currentFileIndex];
        for (const block of file.blocks) {
            // Separator row
            if (block.separator) {
                const sepClass = block.separatorMatch ? 'separator' : 'separator error-sep';
                const origSep = document.createElement('div');
                origSep.className = `block ${sepClass}`;
                origSep.textContent = block.separator;
                origContainer.appendChild(origSep);

                const transSep = document.createElement('div');
                transSep.className = `block ${sepClass}`;
                transSep.textContent = block.separator;
                transContainer.appendChild(transSep);
            }

            // Content row
            const statusClass = !block.lineCountMatch ? 'error-lines' :
                                !block.separatorMatch ? 'error-sep' : 'ok';

            const origBlock = document.createElement('div');
            origBlock.className = `block ${statusClass}`;
            origBlock.textContent = block.originalLines.join('\n');
            origContainer.appendChild(origBlock);

            const transBlock = document.createElement('div');
            transBlock.className = `block ${statusClass}`;
            transBlock.textContent = block.translatedLines.join('\n');
            transContainer.appendChild(transBlock);
        }

        // Sync scroll between columns
        const origBlocks = document.getElementById('original-blocks');
        const transBlocks = document.getElementById('translated-blocks');
        let syncing = false;
        origBlocks.onscroll = () => {
            if (syncing) return;
            syncing = true;
            transBlocks.scrollTop = origBlocks.scrollTop;
            syncing = false;
        };
        transBlocks.onscroll = () => {
            if (syncing) return;
            syncing = true;
            origBlocks.scrollTop = transBlocks.scrollTop;
            syncing = false;
        };
    }

    ipcRenderer.on('compareData', (ev: any, data: CompareData) => {
        compareData = data;
        currentFileIndex = 0;
        renderSummary();
        renderFileTabs();
        renderBlocks();
    });

    document.getElementById('closeBtn').onclick = () => {
        window.close();
    };
})();
