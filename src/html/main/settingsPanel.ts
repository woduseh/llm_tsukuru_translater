import { state, Swal } from './state'
import { isRecord, getString } from '../../types/guards'

export function initSettingsPanel(): void {
    window.api.on('getGlobalSettings', (tt: unknown) => {
        if (!isRecord(tt)) return;
        if(getString(tt, 'language') === 'en'){
            globalThis.loadEn()
        }
        state.globalSettings = tt
        const tData = (state.globalSettings.themeData) as Record<string, string>
        let root = document.documentElement;
        for(const i in tData){
            root.style.setProperty(i,tData[i]);
        }
    })

    window.api.on('is_version', (arg: unknown)=>{
        (globalThis as Record<string, unknown>).version = arg
    })

    document.getElementById('settings')!.onclick = () => {
        if(state.running){
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            })
            return
        }
        window.api.send('settings')
        state.running = true
    }
}
