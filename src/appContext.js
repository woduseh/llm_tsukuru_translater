"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appCtx = void 0;
exports.initAppContext = initAppContext;
exports.appCtx = {
    mainWindow: null,
    settingsWindow: null,
    settings: {},
    gb: {},
    externMsg: {},
    useExternMsg: false,
    externMsgKeys: [],
    llmAbort: false,
    oPath: '',
    sourceDir: '',
    iconPath: '',
    keyvalue: undefined,
    loadEn: null,
    WolfExtData: [],
    WolfEncoding: 'utf8',
    WolfCache: {},
    WolfMetadata: { ver: -1 },
};
function syncToGlobal() {
    const g = globalThis;
    const propertyMap = {
        mwindow: 'mainWindow',
        settingsWindow: 'settingsWindow',
        settings: 'settings',
        gb: 'gb',
        externMsg: 'externMsg',
        useExternMsg: 'useExternMsg',
        externMsgKeys: 'externMsgKeys',
        llmAbort: 'llmAbort',
        oPath: 'oPath',
        sourceDir: 'sourceDir',
        iconPath: 'iconPath',
        keyvalue: 'keyvalue',
        loadEn: 'loadEn',
        WolfExtData: 'WolfExtData',
        WolfEncoding: 'WolfEncoding',
        WolfCache: 'WolfCache',
        WolfMetadata: 'WolfMetadata',
    };
    for (const [globalName, ctxName] of Object.entries(propertyMap)) {
        Object.defineProperty(g, globalName, {
            get: () => exports.appCtx[ctxName],
            set: (v) => { exports.appCtx[ctxName] = v; },
            configurable: true
        });
    }
}
function initAppContext() {
    syncToGlobal();
}
