export const state = {
    running: false,
    config: {
        ext_plugin: false,
        ext_src: false,
        autoline: false,
        instantapply: false,
        ext_note: false,
        exJson: false,
        decryptImg: false,
        decryptAudio: false,
        ext_javascript: false,
        useYaml: false
    },
    mode: -1,
    globalSettings: {},
    loadingTag: '',
    LastTime: -1,
    LastPercent: -1.0,
    estimatedTime: '',
    speedSamples: [],
    llmTranslating: false
};

export const ETA_WINDOW = 10;

export const Swal = window.Swal;
