(() => {
    const { ipcRenderer } = require('electron');

    let settings: { [key: string]: any } = {};

    ipcRenderer.on('llmSettings', (ev: any, arg: any) => {
        settings = arg;
        (document.getElementById('apiKey') as HTMLInputElement).value = settings.llmApiKey || '';
        (document.getElementById('model') as HTMLInputElement).value = settings.llmModel || 'gemini-2.0-flash';
        (document.getElementById('sourceLang') as HTMLSelectElement).value = settings.llmSourceLang || 'ja';
        (document.getElementById('targetLang') as HTMLSelectElement).value = settings.llmTargetLang || 'ko';
        (document.getElementById('translationUnit') as HTMLSelectElement).value = settings.llmTranslationUnit || 'chunk';
        (document.getElementById('chunkSize') as HTMLInputElement).value = String(settings.llmChunkSize || 30);
        (document.getElementById('translatorNotes') as HTMLTextAreaElement).value = settings.llmTranslatorNotes || '';
        (document.getElementById('customPrompt') as HTMLTextAreaElement).value = settings.llmCustomPrompt || '';
        updateChunkSizeVisibility();

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

    function updateChunkSizeVisibility() {
        const unit = (document.getElementById('translationUnit') as HTMLSelectElement).value;
        const chunkGroup = document.getElementById('chunkSizeGroup');
        chunkGroup.style.display = unit === 'file' ? 'none' : 'block';
    }

    document.getElementById('translationUnit').addEventListener('change', updateChunkSizeVisibility);

    document.getElementById('startBtn').onclick = () => {
        const apiKey = (document.getElementById('apiKey') as HTMLInputElement).value.trim();
        if (!apiKey) {
            alert('API 키를 입력해주세요.');
            return;
        }
        const data = {
            llmApiKey: apiKey,
            llmModel: (document.getElementById('model') as HTMLInputElement).value.trim() || 'gemini-2.0-flash',
            llmSourceLang: (document.getElementById('sourceLang') as HTMLSelectElement).value,
            llmTargetLang: (document.getElementById('targetLang') as HTMLSelectElement).value,
            llmTranslationUnit: (document.getElementById('translationUnit') as HTMLSelectElement).value,
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
