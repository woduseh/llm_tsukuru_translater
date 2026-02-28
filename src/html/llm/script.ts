(() => {
    const { ipcRenderer } = require('electron');

    let settings: { [key: string]: any } = {};

    ipcRenderer.on('llmSettings', (ev: any, arg: any) => {
        settings = arg;
        (document.getElementById('apiKey') as HTMLInputElement).value = settings.llmApiKey || '';
        (document.getElementById('model') as HTMLSelectElement).value = settings.llmModel || 'gemini-2.0-flash';
        (document.getElementById('sourceLang') as HTMLSelectElement).value = settings.llmSourceLang || 'ja';
        (document.getElementById('chunkSize') as HTMLInputElement).value = String(settings.llmChunkSize || 30);
        (document.getElementById('translatorNotes') as HTMLTextAreaElement).value = settings.llmTranslatorNotes || '';
        (document.getElementById('customPrompt') as HTMLTextAreaElement).value = settings.llmCustomPrompt || '';

        // Apply theme
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

    document.getElementById('startBtn').onclick = () => {
        const apiKey = (document.getElementById('apiKey') as HTMLInputElement).value.trim();
        if (!apiKey) {
            alert('API 키를 입력해주세요.');
            return;
        }
        const data = {
            llmApiKey: apiKey,
            llmModel: (document.getElementById('model') as HTMLSelectElement).value,
            llmSourceLang: (document.getElementById('sourceLang') as HTMLSelectElement).value,
            llmChunkSize: parseInt((document.getElementById('chunkSize') as HTMLInputElement).value) || 30,
            llmTranslatorNotes: (document.getElementById('translatorNotes') as HTMLTextAreaElement).value,
            llmCustomPrompt: (document.getElementById('customPrompt') as HTMLTextAreaElement).value
        };
        ipcRenderer.send('llmSettingsApply', data);
    };

    document.getElementById('cancelBtn').onclick = () => {
        ipcRenderer.send('llmSettingsClose');
    };
})();
