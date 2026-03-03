(() => {
    const mainMenu = document.querySelector('#mainMenu') as HTMLDivElement
    
    let globalSettings: Record<string, unknown>
    
    window.api.on('getGlobalSettings', (tt: unknown) => {
        globalSettings = tt as Record<string, unknown>
        if((tt as Record<string, unknown>).language === 'en'){
            document.getElementById('lang-en')!.classList.add('btxSel')            
            globalThis.loadEn()
        }
        else{
            document.getElementById('lang-ko')!.classList.add('btxSel')
        }
        const tData = (globalSettings.themeData) as Record<string, string>
        let root = document.documentElement;
        for(const i in tData){
            root.style.setProperty(i,tData[i]);
        }
    })
    
    document.getElementById('icon1')!.onclick = () => {window.api.send('close')}
    document.getElementById('icon2')!.onclick = () => {window.api.send('minimize')}
    document.getElementById('gokupu')!.onclick = () => {window.api.send('changeURL', './src/html/main/index.html')}
    document.getElementById('simpuru')!.onclick = () => {window.api.send('changeURL', './src/html/wolf/index.html')}
    document.getElementById('lang-en')!.onclick = () => {window.api.send('changeLang', 'en')}
    document.getElementById('lang-ko')!.onclick = () => {window.api.send('changeLang', 'ko')}

    window.api.on('set_path', (tt: unknown) => {
        const payload = tt as {type: string; dir: string};
        (document.getElementById(payload.type) as HTMLInputElement).value = payload.dir
        if(payload.type !== 'folder_input'){
            document.getElementById(payload.type)!.innerText = payload.dir
        }
    });
    mainMenu.style.display = 'block'
})()