(() => {

    interface VerifyIssue {
        path: string;
        type: string;
        severity: 'error' | 'warning';
        message: string;
        origValue?: any;
        transValue?: any;
    }

    interface FileEntry {
        name: string;
        origPath: string;
        transPath: string;
        issues: VerifyIssue[];
        errorCount: number;
        warningCount: number;
        repaired: boolean;
    }

    let dataDir = '';
    let origDir = '';
    let transDir = '';
    let files: FileEntry[] = [];
    let currentIdx = 0;

    function detectDirs(dir: string): { origDir: string; transDir: string } | null {
        const completedDir = window.nodePath.join(dir, 'Completed', 'data');
        const backupDir = window.nodePath.join(dir, 'Backup');

        // Completed/data 존재 → Backup(원본) vs Completed/data(번역)
        if (window.nodeFs.existsSync(completedDir)) {
            if (window.nodeFs.existsSync(backupDir)) {
                return { origDir: backupDir, transDir: completedDir };
            }
            return { origDir: dir, transDir: completedDir };
        }

        // Backup만 존재 (즉시 적용 모드) → Backup(원본) vs data(번역)
        if (window.nodeFs.existsSync(backupDir)) {
            return { origDir: backupDir, transDir: dir };
        }

        return null;
    }

    function loadFiles(dir: string) {
        dataDir = dir;
        files = [];
        currentIdx = 0;

        const dirs = detectDirs(dir);
        if (!dirs) {
            document.getElementById('summary')!.innerHTML =
                '<span class="summary-error">Completed/data 또는 Backup 폴더가 없습니다. 적용(Apply)을 먼저 실행하세요.</span>';
            return;
        }

        origDir = dirs.origDir;
        transDir = dirs.transDir;

        const transFiles = window.nodeFs.readdirSync(transDir).filter((f: string) => f.endsWith('.json'));

        for (const name of transFiles) {
            const origPath = window.nodePath.join(origDir, name);
            const transPath = window.nodePath.join(transDir, name);
            if (!window.nodeFs.existsSync(origPath)) continue;

            try {
                let origData = window.nodeFs.readFileSync(origPath, 'utf-8');
                let transData = window.nodeFs.readFileSync(transPath, 'utf-8');
                if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1);
                if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1);

                const orig = JSON.parse(origData);
                const trans = JSON.parse(transData);
                const issues: VerifyIssue[] = window.verify.verifyJsonIntegrity(orig, trans);
                const errorCount = issues.filter(i => i.severity === 'error').length;
                const warningCount = issues.filter(i => i.severity === 'warning').length;

                files.push({ name, origPath, transPath, issues, errorCount, warningCount, repaired: false });
            } catch (e) {
                files.push({
                    name, origPath, transPath,
                    issues: [{ path: '$', type: 'parse_error', severity: 'error', message: `JSON 파싱 오류: ${(e as any).message}` }],
                    errorCount: 1, warningCount: 0, repaired: false
                });
            }
        }

        renderSummary();
        renderFileList();
        renderIssues();
        updateButtons();
    }

    function renderSummary() {
        const el = document.getElementById('summary')!;
        const errorFiles = files.filter(f => f.errorCount > 0).length;
        const warnFiles = files.filter(f => f.warningCount > 0 && f.errorCount === 0).length;
        const totalIssues = files.reduce((sum, f) => sum + f.issues.length, 0);

        if (files.length === 0) {
            el.innerHTML = '<span class="summary-error">비교할 파일이 없습니다.</span>';
        } else if (totalIssues === 0) {
            el.innerHTML = `<span class="summary-ok">✓ 모든 파일의 JSON 구조가 일치합니다 (${files.length}개 파일)</span>`;
        } else {
            const parts: string[] = [];
            if (errorFiles > 0) {
                parts.push(`<span class="summary-error">❌ ${errorFiles}개 파일에서 구조 오류 발견</span>`);
            }
            if (warnFiles > 0) {
                parts.push(`<span class="summary-warn">⚠ ${warnFiles}개 파일에서 경고 발견</span>`);
            }
            parts.push(`<span class="summary-total">(전체 ${files.length}개 파일, ${totalIssues}개 문제)</span>`);
            el.innerHTML = parts.join(' &nbsp; ');
        }
    }

    function getFilteredFiles(): { file: FileEntry; realIdx: number }[] {
        const query = (document.getElementById('file-search') as HTMLInputElement).value.toLowerCase();
        const issuesOnly = (document.getElementById('filter-issues') as HTMLInputElement).checked;
        const result: { file: FileEntry; realIdx: number }[] = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (query && !f.name.toLowerCase().includes(query)) continue;
            if (issuesOnly && f.issues.length === 0) continue;
            result.push({ file: f, realIdx: i });
        }
        return result;
    }

    function renderFileList() {
        const list = document.getElementById('file-list')!;
        list.innerHTML = '';
        const filtered = getFilteredFiles();
        document.getElementById('file-count')!.textContent = `${filtered.length}/${files.length}`;

        for (const { file, realIdx } of filtered) {
            const item = document.createElement('div');
            item.className = 'file-item' + (realIdx === currentIdx ? ' active' : '');

            const nameSpan = document.createElement('span');
            nameSpan.textContent = file.name;
            item.appendChild(nameSpan);

            if (file.repaired) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-repaired';
                badge.textContent = '수정됨';
                item.appendChild(badge);
            }
            if (file.errorCount > 0) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-error';
                badge.textContent = `❌ ${file.errorCount}`;
                item.appendChild(badge);
            }
            if (file.warningCount > 0) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-warn';
                badge.textContent = `⚠ ${file.warningCount}`;
                item.appendChild(badge);
            }
            if (file.issues.length === 0) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-ok';
                badge.textContent = '✓';
                item.appendChild(badge);
            }

            item.onclick = () => {
                currentIdx = realIdx;
                renderFileList();
                renderIssues();
                updateButtons();
            };
            list.appendChild(item);
        }

        const active = list.querySelector('.file-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function renderIssues() {
        const issuesList = document.getElementById('issues-list')!;
        const fileNameEl = document.getElementById('issues-file-name')!;
        issuesList.innerHTML = '';

        if (files.length === 0) {
            fileNameEl.textContent = '';
            issuesList.innerHTML = '<div class="no-files">파일이 없습니다</div>';
            return;
        }

        const f = files[currentIdx];
        fileNameEl.textContent = f.name;

        if (f.issues.length === 0) {
            issuesList.innerHTML = '<div class="no-issues">✓ 구조적 문제가 없습니다</div>';
            return;
        }

        for (const issue of f.issues) {
            const el = document.createElement('div');
            el.className = `issue-item ${issue.severity}`;

            const pathEl = document.createElement('div');
            pathEl.className = 'issue-path';
            pathEl.textContent = issue.path;
            el.appendChild(pathEl);

            const typeEl = document.createElement('div');
            typeEl.className = 'issue-type';
            const typeLabels: { [key: string]: string } = {
                'array_length': '배열 길이 불일치',
                'type_mismatch': '타입 불일치',
                'keys_added': '키 추가됨',
                'keys_removed': '키 제거됨',
                'value_changed': '값 변경됨',
                'string_changed': '번역 불가 문자열 변경',
                'control_char_mismatch': '제어문자 불일치',
                'text_shift': '텍스트 줄밀림',
                'parse_error': 'JSON 파싱 오류'
            };
            typeEl.textContent = typeLabels[issue.type] || issue.type;
            el.appendChild(typeEl);

            const msgEl = document.createElement('div');
            msgEl.className = 'issue-message';
            msgEl.textContent = issue.message;
            el.appendChild(msgEl);

            issuesList.appendChild(el);
        }
    }

    function updateButtons() {
        const hasIssues = files.some(f => f.issues.length > 0);
        const currentHasIssues = files.length > 0 && files[currentIdx].issues.length > 0;

        (document.getElementById('repairAllBtn') as HTMLButtonElement).disabled = !hasIssues;
        (document.getElementById('repairFileBtn') as HTMLButtonElement).disabled = !currentHasIssues;
    }

    function repairFile(idx: number): { success: boolean; error?: string } {
        const f = files[idx];
        if (f.issues.length === 0) return { success: false, error: '문제가 없는 파일입니다' };

        try {
            let origData = window.nodeFs.readFileSync(f.origPath, 'utf-8');
            let transData = window.nodeFs.readFileSync(f.transPath, 'utf-8');
            if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1);
            if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1);

            const orig = JSON.parse(origData);
            const trans = JSON.parse(transData);
            const repaired = window.verify.repairJson(orig, trans);

            const indent = 4 * (globalThis.settings?.JsonChangeLine || 0);
            const output = JSON.stringify(repaired, null, indent);

            // 실제 저장
            window.nodeFs.writeFileSync(f.transPath, output, 'utf-8');

            // 저장 확인: 파일이 실제로 기록되었는지 검증
            const written = window.nodeFs.readFileSync(f.transPath, 'utf-8');
            if (written !== output) {
                return { success: false, error: '파일 저장 후 검증 실패: 기록된 내용이 일치하지 않습니다' };
            }

            // Re-verify
            const newIssues: VerifyIssue[] = window.verify.verifyJsonIntegrity(orig, repaired);
            // 수정 후에는 의도적으로 보존된 warn 레벨 문자열 변경 경고를 제외
            const filteredIssues = newIssues.filter(i =>
                !(i.type === 'string_changed' && i.severity === 'warning')
            );
            f.issues = filteredIssues;
            f.errorCount = filteredIssues.filter(i => i.severity === 'error').length;
            f.warningCount = filteredIssues.filter(i => i.severity === 'warning').length;
            f.repaired = true;
            return { success: true };
        } catch (e) {
            console.error('repairFile error:', e);
            return { success: false, error: (e as any).message || String(e) };
        }
    }

    // IPC: 초기화
    window.api.on('initVerify', (dir: string) => {
        loadFiles(dir);
    });

    window.api.on('verifySettings', (settings: any) => {
        globalThis.settings = settings;
    });

    // 검색 / 필터
    document.getElementById('file-search')!.addEventListener('input', () => renderFileList());
    document.getElementById('filter-issues')!.addEventListener('change', () => renderFileList());

    // 개별 파일 수정
    document.getElementById('repairFileBtn')!.onclick = () => {
        if (files.length === 0) return;
        const result = repairFile(currentIdx);
        const statusEl = document.getElementById('status')!;
        if (result.success) {
            statusEl.textContent = `✓ ${files[currentIdx].name} 수정 및 저장 완료 → ${files[currentIdx].transPath}`;
            statusEl.className = 'status-ok';
        } else {
            statusEl.textContent = `❌ 수정 실패: ${result.error || '알 수 없는 오류'}`;
            statusEl.className = 'status-error';
        }
        renderSummary();
        renderFileList();
        renderIssues();
        updateButtons();
    };

    // 전체 수정
    document.getElementById('repairAllBtn')!.onclick = () => {
        let repaired = 0;
        let failed = 0;
        let lastError = '';
        for (let i = 0; i < files.length; i++) {
            if (files[i].issues.length > 0) {
                const result = repairFile(i);
                if (result.success) {
                    repaired++;
                } else {
                    failed++;
                    lastError = result.error || '';
                }
            }
        }
        const statusEl = document.getElementById('status')!;
        if (failed === 0) {
            statusEl.textContent = `✓ ${repaired}개 파일 수정 및 저장 완료`;
            statusEl.className = 'status-ok';
        } else {
            statusEl.textContent = `${repaired}개 수정 완료, ${failed}개 실패${lastError ? ': ' + lastError : ''}`;
            statusEl.className = 'status-error';
        }
        renderSummary();
        renderFileList();
        renderIssues();
        updateButtons();
    };

    // 닫기
    document.getElementById('closeBtn')!.onclick = () => {
        window.close();
    };
})();
