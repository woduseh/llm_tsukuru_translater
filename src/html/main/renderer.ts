import { state, Swal, ETA_WINDOW } from './state'
import { initTabManager } from './tabManager'
import { initSettingsPanel } from './settingsPanel'
import { initModals } from './modals'
import { initTools } from './tools'
import { isRecord, isString, getString } from '../../types/guards'

function toHHMMSS(num:number) {
    const sec_num = Math.max(0, Math.round(num))
    const hours = Math.floor(sec_num / 3600)
    const minutes = Math.floor((sec_num % 3600) / 60)
    const seconds = sec_num % 60
    let timeString = ''
    if (hours > 0) timeString += `${hours}시간 `
    if (minutes > 0) timeString += `${minutes}분 `
    timeString += `${seconds}초`
    return timeString
}

// Window controls
document.getElementById('icon1')!.onclick = () => {window.api.send('close')}
document.getElementById('icon2')!.onclick = () => {window.api.send('minimize')}
document.getElementById('fold')!.onclick = () => {window.api.send("openFolder", (document.getElementById('folder_input') as HTMLInputElement).value)}
document.querySelector('#sel')!.addEventListener('click', () => {
    window.api.send('select_folder', 'folder_input');
});

window.api.send('setheight', 550);

window.api.on('set_path', (tt: unknown) => {
    if (!isRecord(tt)) return;
    const type = getString(tt, 'type');
    const dir = getString(tt, 'dir');
    (document.getElementById(type) as HTMLInputElement).value = dir
    if(type !== 'folder_input'){
        document.getElementById(type)!.innerText = dir
    }
});

// Loading bar
window.api.on('loadingTag', (tt: unknown) => {
    if (!isString(tt)) return;
    state.loadingTag = tt
})

window.api.on('loading', (tt: number) => {
    document.getElementById('border_r')!.style.width = `${tt}vw`
    let ds = Math.floor(new Date().getTime()/1000)
    if(tt > 0 && state.globalSettings.loadingText){
        if(state.LastTime != ds){
            const ChangedTime = ds - state.LastTime
            state.LastTime = ds
            let OldPercent = state.LastPercent
            state.LastPercent = Number(tt)
            const movedPercent = (state.LastPercent - OldPercent) / ChangedTime
            if(movedPercent > 0){
                state.speedSamples.push(movedPercent)
                if(state.speedSamples.length > ETA_WINDOW) state.speedSamples.shift()
            }
            if(state.speedSamples.length > 0){
                const avgSpeed = state.speedSamples.reduce((a, b) => a + b, 0) / state.speedSamples.length
                let TimeLeftSec = (100 - state.LastPercent) / avgSpeed
                state.estimatedTime = `${toHHMMSS(TimeLeftSec)} 남음`
            }
        }
        document.getElementById('loading-text')!.innerText = `${state.loadingTag}${state.loadingTag ? ' · ' : ''}${Number(tt).toFixed(1)}% ${state.estimatedTime}`
        document.getElementById('loading-text')!.style.visibility = 'visible'
    }
    else{
        state.speedSamples = []
        state.estimatedTime = ''
        state.LastTime = ds
        state.LastPercent = -1.0
        document.getElementById('loading-text')!.style.visibility = 'hidden'
        state.loadingTag = ''
    }
});

window.api.on('worked', () => {state.running = false})

// Wolf RPG page
document.getElementById('WolfBtn')!.onclick = () => {
    window.api.send('changeURL', './src/html/wolf/index.html')
}

// Run button
document.getElementById('run')!.onclick = () => {
    if(state.running){
        Swal.fire({
            icon: 'error',
            text: '이미 다른 작업이 시행중입니다!',
        })
        return
    }
    const kas = (document.getElementById('folder_input') as HTMLInputElement).value
    if(state.mode == 0){
        const a = {
            dir: window.nodeBuffer.toBase64(kas.replace('\\','/'))
        };
        state.running = true
        window.api.send('extract', {...a, ...state.config});
    }
    else if(state.mode == 1){
        const a = {
            dir: window.nodeBuffer.toBase64(kas.replace('\\','/'))
        };
        state.running = true
        window.api.send('apply', {...a, ...state.config});
    }
}

// Initialize modules
initTabManager()
initSettingsPanel()
initModals()
initTools()
