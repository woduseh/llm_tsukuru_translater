"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Swal = exports.ETA_WINDOW = exports.state = void 0;
exports.state = {
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
exports.ETA_WINDOW = 10;
//@ts-ignore
exports.Swal = window.Swal;
