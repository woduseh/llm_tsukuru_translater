(() => {
    let settings: Record<string, any> = {};

    window.api.on('llmSettings', (arg: unknown) => {
        settings = arg as Record<string, any>;
        (document.getElementById('sortOrder') as HTMLSelectElement).value = settings.llmSortOrder || 'name-asc';

        if (settings.themeData) {
            const root = document.documentElement;
            for (const key in settings.themeData) {
                root.style.setProperty(key, settings.themeData[key]);
            }
        }
        if (settings.language === 'en') {
            globalThis.loadEn?.();
        }
    });

    document.getElementById('startBtn')!.onclick = () => {
        if (!settings.llmApiKey) {
            alert('API 키가 설정되지 않았습니다. 메인 설정에서 API 키를 입력해주세요.');
            return;
        }
        const data = {
            llmResetProgress: (document.getElementById('resetProgress') as HTMLInputElement).checked,
            llmSortOrder: (document.getElementById('sortOrder') as HTMLSelectElement).value,
            llmTranslationMode: (document.getElementById('translationMode') as HTMLSelectElement).value
        };
        window.api.send('llmSettingsApply', data);
    };

    document.getElementById('cancelBtn')!.onclick = () => {
        window.api.send('llmSettingsClose');
    };
})();
