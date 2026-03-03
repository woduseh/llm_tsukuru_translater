import { state } from './state'

export function reloadUI(): void {
    if(state.mode == 0){
        document.getElementById('ext')!.style.backgroundColor = 'var(--Selected)'
        document.getElementById('ext')!.style.opacity = '1'
        document.getElementById('ext')!.style.color = '#fff'
        document.getElementById('apply')!.style.backgroundColor = ''
        document.getElementById('apply')!.style.opacity = ''
        document.getElementById('apply')!.style.color = ''
        if (document.getElementById('c-ext')!.classList.contains("hiddenc")) {
            document.getElementById('c-ext')!.classList.remove("hiddenc");}
        if (!document.getElementById('c-app')!.classList.contains("hiddenc")) {
            document.getElementById('c-app')!.classList.add("hiddenc");}
    }
    else if(state.mode == 1){
        document.getElementById('ext')!.style.backgroundColor = ''
        document.getElementById('ext')!.style.opacity = ''
        document.getElementById('ext')!.style.color = ''
        document.getElementById('apply')!.style.backgroundColor = 'var(--Selected)'
        document.getElementById('apply')!.style.opacity = '1'
        document.getElementById('apply')!.style.color = '#fff'
        if (document.getElementById('c-app')!.classList.contains("hiddenc")) {
            document.getElementById('c-app')!.classList.remove("hiddenc");}
        if (!document.getElementById('c-ext')!.classList.contains("hiddenc")) {
            document.getElementById('c-ext')!.classList.add("hiddenc");}
    }
    else{
        document.getElementById('ext')!.style.backgroundColor = ''
        document.getElementById('ext')!.style.opacity = ''
        document.getElementById('ext')!.style.color = ''
        document.getElementById('apply')!.style.backgroundColor = ''
        document.getElementById('apply')!.style.opacity = ''
        document.getElementById('apply')!.style.color = ''
    }
    const DomList = ['ext_plugin','ext_note','ext_src','autoline','instantapply','exJson','decryptImg','decryptAudio', 'ext_javascript']
    for(const i in DomList){
        if((state.config as unknown as Record<string, boolean>)[DomList[i]]){
            document.getElementById(DomList[i])!.style.backgroundColor = 'var(--Selected)'
            document.getElementById(DomList[i])!.style.color = '#fff'
        }
        else{
            document.getElementById(DomList[i])!.style.backgroundColor = ''
            document.getElementById(DomList[i])!.style.color = ''
        }
    }
}

export function initTabManager(): void {
    document.getElementById('ext')!.onclick = () => {state.mode=0;reloadUI()}
    document.getElementById('apply')!.onclick = () => {state.mode=1;reloadUI()}
    reloadUI()
}
