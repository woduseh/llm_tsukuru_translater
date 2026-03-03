(() => {
    const mainMenu = document.querySelector('#mainMenu') as HTMLDivElement
    
    let globalSettings
    
    window.api.on('getGlobalSettings', (tt: any) => {
        globalSettings = tt
        if(tt.language === 'en'){
            document.getElementById('lang-en')!.classList.add('btxSel')            
            globalThis.loadEn()
        }
        else{
            document.getElementById('lang-ko')!.classList.add('btxSel')
        }
        const tData = (globalSettings.themeData)
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

    window.api.on('set_path', (tt: any) => {
        (document.getElementById(tt.type) as HTMLInputElement).value = tt.dir
        if(tt.type !== 'folder_input'){
            document.getElementById(tt.type)!.innerText = tt.dir
        }
    });
    mainMenu.style.display = 'block'
})()