"use strict";
(() => {
    const bottomMenu = document.querySelector('.smalmar');
    const mainMenu = document.querySelector('#mainMenu');
    const simpleMenu = document.querySelector('#simpleMenu');
    let running = false;
    let globalSettings;
    let LastPercent = -1.0;
    let speedSamples = [];
    const ETA_WINDOW = 10;
    let estimatedTime = '';
    let loadingTag = '';
    function isRecord(val) {
        return val !== null && typeof val === 'object' && !Array.isArray(val);
    }
    function isString(val) {
        return typeof val === 'string';
    }
    function isBoolean(val) {
        return typeof val === 'boolean';
    }
    function getString(obj, key, fallback = '') {
        const v = obj[key];
        return typeof v === 'string' ? v : fallback;
    }
    function toHHMMSS(num) {
        const sec_num = Math.max(0, Math.round(num));
        const hours = Math.floor(sec_num / 3600);
        const minutes = Math.floor((sec_num % 3600) / 60);
        const seconds = sec_num % 60;
        let timeString = '';
        if (hours > 0)
            timeString += `${hours}시간 `;
        if (minutes > 0)
            timeString += `${minutes}분 `;
        timeString += `${seconds}초`;
        return timeString;
    }
    window.api.send('setheight', 550);
    //@ts-ignore
    const Swal = window.Swal;
    window.api.on('getGlobalSettings', (tt) => {
        if (!isRecord(tt))
            return;
        globalSettings = tt;
        if (getString(tt, 'language') === 'en') {
            globalThis.loadEn();
        }
        const tData = (globalSettings.themeData);
        let root = document.documentElement;
        for (const i in tData) {
            root.style.setProperty(i, tData[i]);
        }
    });
    window.api.on('alertExten', async (arg) => {
        if (!Array.isArray(arg))
            return;
        const { isDenied } = await Swal.fire({
            icon: 'success',
            showDenyButton: true,
            denyButtonText: "아니요",
            title: String(arg[0]),
        });
        if (!isDenied) {
            window.api.send("getextention", String(arg[1]));
        }
        else {
            window.api.send("getextention", 'none');
        }
    });
    let config = {};
    let LastTime = -1;
    function changeMenu(type) {
        bottomMenu.style.display = 'none';
        simpleMenu.style.display = 'none';
        if (type === 'simple') {
            simpleMenu.style.display = 'flex';
            simpleMenu.style.flexDirection = 'column';
            bottomMenu.style.display = 'flex';
        }
    }
    document.getElementById('icon1').onclick = () => { window.api.send('close'); };
    document.getElementById('icon2').onclick = () => { window.api.send('minimize'); };
    document.getElementById('sel').addEventListener('click', () => {
        window.api.send('select_folder', 'folder_input');
    });
    window.api.on('set_path', (tt) => {
        if (!isRecord(tt))
            return;
        const type = getString(tt, 'type');
        const dir = getString(tt, 'dir');
        document.getElementById(type).value = dir;
        if (type !== 'folder_input') {
            document.getElementById(type).innerText = dir;
        }
    });
    document.getElementById('WolfBtn').onclick = () => {
        window.api.send('changeURL', './src/html/main/index.html');
    };
    changeMenu('simple');
    {
        document.getElementById('marTrans').onclick = () => {
            document.getElementById('handTrans').removeAttribute('selected');
            document.getElementById('marTrans').setAttribute('selected', '');
            document.getElementById('marCont').style.display = 'block';
            document.getElementById('handCont').style.display = 'none';
            if (globalSettings.HideExtractAll) {
                document.getElementById('ext-all').style.display = 'none';
            }
            else {
                document.getElementById('ext-all').style.display = 'block';
            }
        };
        document.getElementById('handTrans').onclick = () => {
            document.getElementById('marTrans').removeAttribute('selected');
            document.getElementById('handTrans').setAttribute('selected', '');
            document.getElementById('handCont').style.display = 'block';
            document.getElementById('marCont').style.display = 'none';
        };
        document.getElementById('runbtn').onclick = () => {
            if (running) {
                Swal.fire({
                    icon: 'error',
                    text: '이미 다른 작업이 시행중입니다!',
                });
                return;
            }
            running = true;
            const folder = document.getElementById('folder_input').value;
            window.api.send('wolf_ext', { folder: folder, config: config });
        };
        document.getElementById('runbtn2').onclick = () => {
            if (running) {
                Swal.fire({
                    icon: 'error',
                    text: '이미 다른 작업이 시행중입니다!',
                });
                return;
            }
            running = true;
            const folder = document.getElementById('folder_input').value;
            window.api.send('wolf_apply', { folder: folder, config: config });
        };
        document.getElementById('fold').onclick = () => { window.api.send("openFolder", document.getElementById('folder_input').value); };
    }
    {
        const doms = document.querySelectorAll('[btn-val]');
        for (let i = 0; i < doms.length; i++) {
            const dom = doms[i];
            dom.addEventListener('click', () => {
                const da = dom.getAttribute('btn-val');
                if (dom.hasAttribute('btn-active')) {
                    dom.removeAttribute('btn-active');
                }
                else {
                    dom.setAttribute('btn-active', '');
                }
                config[da] = dom.hasAttribute('btn-active');
            });
        }
    }
    window.api.on('alert', (tt) => {
        if (isString(tt)) {
            Swal.fire({
                icon: 'success',
                title: tt,
            });
        }
        else if (isRecord(tt)) {
            Swal.fire({
                icon: getString(tt, 'icon', 'info'),
                title: getString(tt, 'message'),
            });
        }
    });
    window.api.on('loadingTag', (tt) => {
        if (!isString(tt))
            return;
        loadingTag = tt;
    });
    window.api.on('loading', (tt) => {
        document.getElementById('border_r').style.width = `${tt}vw`;
        let ds = Math.floor(new Date().getTime() / 1000);
        if (tt > 0 && globalSettings.loadingText) {
            if (LastTime != ds) {
                const ChangedTime = ds - LastTime;
                LastTime = ds;
                let OldPercent = LastPercent;
                LastPercent = Number(tt);
                const movedPercent = (LastPercent - OldPercent) / ChangedTime;
                if (movedPercent > 0) {
                    speedSamples.push(movedPercent);
                    if (speedSamples.length > ETA_WINDOW)
                        speedSamples.shift();
                }
                if (speedSamples.length > 0) {
                    const avgSpeed = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;
                    let TimeLeftSec = (100 - LastPercent) / avgSpeed;
                    estimatedTime = `${toHHMMSS(TimeLeftSec)} 남음`;
                }
            }
            document.getElementById('loading-text').innerText = `${loadingTag}${loadingTag ? ' · ' : ''}${Number(tt).toFixed(1)}% ${estimatedTime}`;
            document.getElementById('loading-text').style.visibility = 'visible';
        }
        else {
            speedSamples = [];
            estimatedTime = '';
            LastTime = ds;
            LastPercent = -1.0;
            document.getElementById('loading-text').style.visibility = 'hidden';
            loadingTag = '';
        }
    });
    window.api.on('alert2', async (tt) => {
        const { isDenied } = await Swal.fire({
            icon: 'success',
            showDenyButton: true,
            denyButtonText: "폴더 열기",
            title: '완료되었습니다',
        });
        if (isDenied) {
            window.api.send("openFolder", document.getElementById('folder_input').value);
        }
    });
    document.getElementById('eztrans').onclick = async () => {
        if (running) {
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            });
            return;
        }
        const dir = document.getElementById('folder_input').value.replaceAll('\\', '/');
        window.api.send('openLLMSettings', { dir: dir, game: 'wolf' });
    };
    document.getElementById('llmCompare').onclick = () => {
        const dir = document.getElementById('folder_input').value.replaceAll('\\', '/');
        if (!dir) {
            Swal.fire({ icon: 'error', text: '프로젝트 폴더를 먼저 선택하세요.' });
            return;
        }
        window.api.send('openLLMCompare', dir);
    };
    // LLM translation abort button
    let llmTranslating = false;
    window.api.on('llmTranslating', (val) => {
        if (!isBoolean(val))
            return;
        llmTranslating = val;
        document.getElementById('abort-llm-btn').style.display = val ? 'block' : 'none';
    });
    document.getElementById('abort-llm-btn').onclick = async () => {
        const result = await Swal.fire({
            icon: 'warning',
            text: '번역을 중단하시겠습니까?\n현재까지의 진행 상태는 저장됩니다.',
            confirmButtonText: '중단',
            showDenyButton: true,
            denyButtonText: '계속',
        });
        if (result.isConfirmed) {
            window.api.send('abortLLM');
        }
    };
    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape' && llmTranslating) {
            const result = await Swal.fire({
                icon: 'warning',
                text: '번역을 중단하시겠습니까?\n현재까지의 진행 상태는 저장됩니다.',
                confirmButtonText: '중단',
                showDenyButton: true,
                denyButtonText: '계속',
            });
            if (result.isConfirmed) {
                window.api.send('abortLLM');
            }
        }
    });
    window.api.on('worked', () => {
        running = false;
    });
    document.getElementById('settings').onclick = () => {
        if (running) {
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            });
            return;
        }
        window.api.send('settings');
        running = true;
    };
})();
