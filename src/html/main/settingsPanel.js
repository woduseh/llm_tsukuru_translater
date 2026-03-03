"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSettingsPanel = initSettingsPanel;
const state_1 = require("./state");
const guards_1 = require("../../types/guards");
function initSettingsPanel() {
    window.api.on('getGlobalSettings', (tt) => {
        if (!(0, guards_1.isRecord)(tt))
            return;
        if ((0, guards_1.getString)(tt, 'language') === 'en') {
            globalThis.loadEn();
        }
        state_1.state.globalSettings = tt;
        const tData = (state_1.state.globalSettings.themeData);
        let root = document.documentElement;
        for (const i in tData) {
            root.style.setProperty(i, tData[i]);
        }
    });
    window.api.on('is_version', (arg) => {
        globalThis.version = arg;
    });
    document.getElementById('settings').onclick = () => {
        if (state_1.state.running) {
            state_1.Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            });
            return;
        }
        window.api.send('settings');
        state_1.state.running = true;
    };
}
