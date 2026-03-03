"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const state_1 = require("./state");
const tabManager_1 = require("./tabManager");
const settingsPanel_1 = require("./settingsPanel");
const modals_1 = require("./modals");
const tools_1 = require("./tools");
const guards_1 = require("../../types/guards");
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
// Window controls
document.getElementById('icon1').onclick = () => { window.api.send('close'); };
document.getElementById('icon2').onclick = () => { window.api.send('minimize'); };
document.getElementById('fold').onclick = () => { window.api.send("openFolder", document.getElementById('folder_input').value); };
document.querySelector('#sel').addEventListener('click', () => {
    window.api.send('select_folder', 'folder_input');
});
window.api.send('setheight', 550);
window.api.on('set_path', (tt) => {
    if (!(0, guards_1.isRecord)(tt))
        return;
    const type = (0, guards_1.getString)(tt, 'type');
    const dir = (0, guards_1.getString)(tt, 'dir');
    document.getElementById(type).value = dir;
    if (type !== 'folder_input') {
        document.getElementById(type).innerText = dir;
    }
});
// Loading bar
window.api.on('loadingTag', (tt) => {
    if (!(0, guards_1.isString)(tt))
        return;
    state_1.state.loadingTag = tt;
});
window.api.on('loading', (tt) => {
    document.getElementById('border_r').style.width = `${tt}vw`;
    let ds = Math.floor(new Date().getTime() / 1000);
    if (tt > 0 && state_1.state.globalSettings.loadingText) {
        if (state_1.state.LastTime != ds) {
            const ChangedTime = ds - state_1.state.LastTime;
            state_1.state.LastTime = ds;
            let OldPercent = state_1.state.LastPercent;
            state_1.state.LastPercent = Number(tt);
            const movedPercent = (state_1.state.LastPercent - OldPercent) / ChangedTime;
            if (movedPercent > 0) {
                state_1.state.speedSamples.push(movedPercent);
                if (state_1.state.speedSamples.length > state_1.ETA_WINDOW)
                    state_1.state.speedSamples.shift();
            }
            if (state_1.state.speedSamples.length > 0) {
                const avgSpeed = state_1.state.speedSamples.reduce((a, b) => a + b, 0) / state_1.state.speedSamples.length;
                let TimeLeftSec = (100 - state_1.state.LastPercent) / avgSpeed;
                state_1.state.estimatedTime = `${toHHMMSS(TimeLeftSec)} 남음`;
            }
        }
        document.getElementById('loading-text').innerText = `${state_1.state.loadingTag}${state_1.state.loadingTag ? ' · ' : ''}${Number(tt).toFixed(1)}% ${state_1.state.estimatedTime}`;
        document.getElementById('loading-text').style.visibility = 'visible';
    }
    else {
        state_1.state.speedSamples = [];
        state_1.state.estimatedTime = '';
        state_1.state.LastTime = ds;
        state_1.state.LastPercent = -1.0;
        document.getElementById('loading-text').style.visibility = 'hidden';
        state_1.state.loadingTag = '';
    }
});
window.api.on('worked', () => { state_1.state.running = false; });
// Wolf RPG page
document.getElementById('WolfBtn').onclick = () => {
    window.api.send('changeURL', './src/html/wolf/index.html');
};
// Run button
document.getElementById('run').onclick = () => {
    if (state_1.state.running) {
        state_1.Swal.fire({
            icon: 'error',
            text: '이미 다른 작업이 시행중입니다!',
        });
        return;
    }
    const kas = document.getElementById('folder_input').value;
    if (state_1.state.mode == 0) {
        const a = {
            dir: window.nodeBuffer.toBase64(kas.replace('\\', '/'))
        };
        state_1.state.running = true;
        window.api.send('extract', { ...a, ...state_1.state.config });
    }
    else if (state_1.state.mode == 1) {
        const a = {
            dir: window.nodeBuffer.toBase64(kas.replace('\\', '/'))
        };
        state_1.state.running = true;
        window.api.send('apply', { ...a, ...state_1.state.config });
    }
};
// Initialize modules
(0, tabManager_1.initTabManager)();
(0, settingsPanel_1.initSettingsPanel)();
(0, modals_1.initModals)();
(0, tools_1.initTools)();
