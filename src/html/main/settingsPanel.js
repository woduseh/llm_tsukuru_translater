import { state, Swal } from './state.js';
import { isRecord, getString } from '../../types/guards.js';

export function initSettingsPanel() {
    window.api.on('getGlobalSettings', (tt) => {
        if (!isRecord(tt)) return;
        if (getString(tt, 'language') === 'en') {
            globalThis.loadEn();
        }
        state.globalSettings = tt;
        const tData = (state.globalSettings.themeData);
        let root = document.documentElement;
        for (const i in tData) {
            root.style.setProperty(i, tData[i]);
        }
    });

    window.api.on('is_version', (arg) => {
        globalThis.version = arg;
    });

    document.getElementById('settings').onclick = () => {
        if (state.running) {
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            });
            return;
        }
        window.api.send('settings');
        state.running = true;
    };
}
