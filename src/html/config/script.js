let gsettings = {};
const CheckboxValues = [
    'ExtractAddLine',
    'onefile_src',
    'onefile_note',
    'JsonChangeLine',
    'extractSomeScript',
    'oneMapFile',
    'loadingText',
    'ExternMsgJson',
    'DoNotTransHangul',
    'formatNice'
];
window.api.on("settings", (arg) => {
    var _a, _b, _c;
    try {
        gsettings = arg;
        const ess2 = arg.extractSomeScript2;
        const extractPlus = arg.extractPlus;
        if (arg.language === 'en') {
            globalThis.loadEn();
        }
        document.getElementById('extractSomeScript2').value += ess2.join('\n');
        document.getElementById('extractPlus').value += extractPlus.map(String).join('\n');
        CheckboxValues.forEach((val) => {
            document.getElementById(val).checked = gsettings[val];
        });
        document.getElementById('llmApiKey').value = gsettings.llmApiKey || '';
        document.getElementById('llmModel').value = gsettings.llmModel || 'gemini-3.0-flash-preview';
        document.getElementById('llmSourceLang').value = gsettings.llmSourceLang || 'ja';
        document.getElementById('llmTargetLang').value = gsettings.llmTargetLang || 'ko';
        document.getElementById('llmTranslationUnit').value = gsettings.llmTranslationUnit || 'file';
        document.getElementById('llmChunkSize').value = String(gsettings.llmChunkSize || 30);
        document.getElementById('llmMaxRetries').value = String((_a = gsettings.llmMaxRetries) !== null && _a !== void 0 ? _a : 2);
        document.getElementById('llmMaxApiRetries').value = String((_b = gsettings.llmMaxApiRetries) !== null && _b !== void 0 ? _b : 5);
        document.getElementById('llmTimeout').value = String((_c = gsettings.llmTimeout) !== null && _c !== void 0 ? _c : 600);
        document.getElementById('llmCustomPrompt').value = gsettings.llmCustomPrompt || '';
        updateChunkSizeVisibility();
        document.getElementById('license').onclick = () => { window.api.send('license'); };
        _reload();
    }
    catch (e) {
        alert(e);
    }
});
function _reload() {
    if (gsettings.extractSomeScript) {
        document.getElementById('extractSomeScript2').className = '';
    }
    else {
        document.getElementById('extractSomeScript2').className = 'invisible';
    }
}
function updateChunkSizeVisibility() {
    const unit = document.getElementById('llmTranslationUnit').value;
    document.getElementById('chunkSizeGroup').style.display = unit === 'file' ? 'none' : '';
}
document.getElementById('llmTranslationUnit').addEventListener('change', updateChunkSizeVisibility);
document.getElementById('extractSomeScript').addEventListener('change', (event) => {
    gsettings.extractSomeScript = document.getElementById('extractSomeScript').checked;
    _reload();
});
document.getElementById('apply').onclick = () => {
    var _a, _b;
    CheckboxValues.forEach((val) => {
        gsettings[val] = document.getElementById(val).checked;
    });
    gsettings.theme = 'Dracula';
    gsettings.extractSomeScript2 = document.getElementById('extractSomeScript2').value.split('\n');
    const extractPlusValues = document.getElementById('extractPlus').value.split('\n');
    let extP = [];
    for (const val of extractPlusValues) {
        const tn = parseInt(val);
        if (!isNaN(tn)) {
            extP.push(tn);
        }
    }
    gsettings.extractPlus = extP;
    // LLM settings
    gsettings.llmApiKey = document.getElementById('llmApiKey').value;
    gsettings.llmModel = document.getElementById('llmModel').value;
    gsettings.llmSourceLang = document.getElementById('llmSourceLang').value;
    gsettings.llmTargetLang = document.getElementById('llmTargetLang').value;
    gsettings.llmTranslationUnit = document.getElementById('llmTranslationUnit').value;
    gsettings.llmChunkSize = parseInt(document.getElementById('llmChunkSize').value) || 30;
    gsettings.llmMaxRetries = (_a = parseInt(document.getElementById('llmMaxRetries').value)) !== null && _a !== void 0 ? _a : 2;
    gsettings.llmMaxApiRetries = (_b = parseInt(document.getElementById('llmMaxApiRetries').value)) !== null && _b !== void 0 ? _b : 5;
    gsettings.llmTimeout = parseInt(document.getElementById('llmTimeout').value) || 600;
    gsettings.llmCustomPrompt = document.getElementById('llmCustomPrompt').value;
    window.api.send('applysettings', gsettings);
};
document.getElementById('close').onclick = () => {
    window.api.send('closesettings', gsettings);
};
