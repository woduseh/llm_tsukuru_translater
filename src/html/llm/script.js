"use strict";
(() => {
    let settings = {};
    window.api.on('llmSettings', (arg) => {
        var _a;
        settings = arg;
        document.getElementById('sortOrder').value = settings.llmSortOrder || 'name-asc';
        if (settings.themeData) {
            const root = document.documentElement;
            for (const key in settings.themeData) {
                root.style.setProperty(key, settings.themeData[key]);
            }
        }
        if (settings.language === 'en') {
            (_a = globalThis.loadEn) === null || _a === void 0 ? void 0 : _a.call(globalThis);
        }
    });
    document.getElementById('startBtn').onclick = () => {
        if (!settings.llmApiKey) {
            alert('API 키가 설정되지 않았습니다. 메인 설정에서 API 키를 입력해주세요.');
            return;
        }
        const data = {
            llmResetProgress: document.getElementById('resetProgress').checked,
            llmSortOrder: document.getElementById('sortOrder').value,
            llmTranslationMode: document.getElementById('translationMode').value
        };
        window.api.send('llmSettingsApply', data);
    };
    document.getElementById('cancelBtn').onclick = () => {
        window.api.send('llmSettingsClose');
    };
})();
