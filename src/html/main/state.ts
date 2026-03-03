export interface AppConfig {
    ext_plugin: boolean
    ext_src: boolean
    autoline: boolean
    instantapply: boolean
    ext_note: boolean
    exJson: boolean
    decryptImg: boolean
    decryptAudio: boolean
    ext_javascript: boolean
    useYaml: boolean
}

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
    } as AppConfig,
    mode: -1,
    globalSettings: {} as {[key:string]:unknown},
    loadingTag: '',
    LastTime: -1,
    LastPercent: -1.0,
    estimatedTime: '',
    speedSamples: [] as number[],
    llmTranslating: false
}

export const ETA_WINDOW = 10

//@ts-ignore
export const Swal = window.Swal
