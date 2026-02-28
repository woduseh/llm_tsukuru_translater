(() => {
    const { ipcRenderer} = require('electron');
    const bottomMenu = document.querySelector('.smalmar') as HTMLDivElement
    const mainMenu = document.querySelector('#mainMenu') as HTMLDivElement
    const simpleMenu = document.querySelector('#simpleMenu') as HTMLDivElement
    let running = false
    let globalSettings:{[key:string]:any}
    let LastPercent = -1.0
    let zinheng = [0, 0]
    let estimatedTime = ''
    let loadingTag = ''

    ipcRenderer.send('setheight', 420);
    //@ts-ignore
    const Swal = window.Swal
    
    ipcRenderer.on('getGlobalSettings', (evn, tt) => {
        globalSettings = tt
        if(tt.language === 'en'){
            globalThis.loadEn()
        }
        const tData = (globalSettings.themeData)
        let root = document.documentElement;
        for(const i in tData){
            root.style.setProperty(i,tData[i]);
        }
    })

    ipcRenderer.on('alertExten', async (ev, arg) => {
        const {isDenied} = await Swal.fire({
            icon: 'success',
            showDenyButton: true,
            denyButtonText: "아니요",
            title: arg[0],
        })
        if(!isDenied){
            ipcRenderer.send("getextention", arg[1])
        }
        else{
            ipcRenderer.send("getextention", 'none')
        }
    })

    let config:{[key:string]:boolean} = {}
    let LastTime = -1

    function changeMenu(type:'main'|'simple'){
        bottomMenu.style.display = 'none'
        simpleMenu.style.display = 'none'
        if(type === 'simple'){
            simpleMenu.style.display = 'block'
            bottomMenu.style.display = 'flex'
        }
    }
    
    document.getElementById('icon1').onclick = () => {ipcRenderer.send('close')}
    document.getElementById('icon2').onclick = () => {ipcRenderer.send('minimize')}
    document.getElementById('sel').addEventListener('click', () => {
        ipcRenderer.send('select_folder', 'folder_input');
    });
    ipcRenderer.on('set_path', (evn, tt) => {
        (document.getElementById(tt.type) as HTMLInputElement).value = tt.dir
        if(tt.type !== 'folder_input'){
            document.getElementById(tt.type).innerText = tt.dir
        }
    });
    document.getElementById('WolfBtn').onclick = () => {
        ipcRenderer.send('changeURL', './src/html/main/index.html')
    }
    changeMenu('simple')
    {
        document.getElementById('marTrans').onclick = () => {
            document.getElementById('handTrans').removeAttribute('selected')
            document.getElementById('marTrans').setAttribute('selected', '')
            document.getElementById('marCont').style.display = 'flex'
            document.getElementById('handCont').style.display = 'none'
            if(globalSettings.HideExtractAll){
                document.getElementById('ext-all').style.display = 'none'
            }
            else{
                document.getElementById('ext-all').style.display = 'block'
            }
        }
        document.getElementById('handTrans').onclick = () => {
            document.getElementById('marTrans').removeAttribute('selected')
            document.getElementById('handTrans').setAttribute('selected', '')
            document.getElementById('handCont').style.display = 'flex'
            document.getElementById('marCont').style.display = 'none'
        }
        document.getElementById('runbtn').onclick = () => {
            if(running){
                Swal.fire({
                    icon: 'error',
                    text: '이미 다른 작업이 시행중입니다!',
                })
                return
            }
            running = true
            const folder = (document.getElementById('folder_input') as HTMLInputElement).value
            ipcRenderer.send('wolf_ext', {folder:folder,config:config})
        }
        document.getElementById('runbtn2').onclick = () => {
            if(running){
                Swal.fire({
                    icon: 'error',
                    text: '이미 다른 작업이 시행중입니다!',
                })
                return
            }
            running = true
            const folder = (document.getElementById('folder_input') as HTMLInputElement).value
            ipcRenderer.send('wolf_apply', {folder:folder,config:config})
        }

        document.getElementById('fold').onclick = () => {ipcRenderer.send("openFolder", (document.getElementById('folder_input') as HTMLInputElement).value)}

    }
    {
        const doms = document.querySelectorAll('[btn-val]')
        for(let i=0;i<doms.length;i++){
            const dom = doms[i] as HTMLElement
            dom.addEventListener('click', () => {
                const da = dom.getAttribute('btn-val')
                if(dom.hasAttribute('btn-active')){
                    dom.removeAttribute('btn-active')
                }
                else{
                    dom.setAttribute('btn-active', '')
                }
                config[da] = dom.hasAttribute('btn-active')
            })
        }
    }

    ipcRenderer.on('alert', (evn, tt) => {
        if (typeof tt === 'string') {
            Swal.fire({
                icon: 'success',
                title: tt,
            })
        }
        else{
            Swal.fire({
                icon: tt.icon,
                title: tt.message,
            })
        }
    });

    ipcRenderer.on('loadingTag', (evn, tt) => {
        loadingTag = tt
    })

    ipcRenderer.on('loading', (evn, tt) => {
        document.getElementById('border_r').style.width = `${tt}vw`
        let ds = Math.floor(new Date().getTime()/1000)
        if(tt > 0 && globalSettings.loadingText){
            if(LastTime != ds){
                const toHHMMSS = function (num) {
                    const sec_num = parseInt(num, 10);
                    const hours   = Math.floor(sec_num / 3600);
                    const minutes = Math.floor((sec_num - (hours * 3600)) / 60);
                    const seconds = sec_num - (hours * 3600) - (minutes * 60);
                    let timeString = ''
                    if(hours > 0){timeString += `${hours}시간 `}
                    if(minutes > 0){timeString += `${minutes}분 `}
                    timeString += `${seconds}초`
                    return timeString;
                }
                const ChangedTime = ds - LastTime
                LastTime = ds
                let OldPercent = LastPercent
                LastPercent = parseFloat(tt)
                const movedPercent = (LastPercent - OldPercent) / ChangedTime
                if(zinheng[1] == 0){
                    zinheng[0] = movedPercent
                }
                else{
                    zinheng[0] = ((zinheng[0]*zinheng[1]) + movedPercent)/(zinheng[1]+1)
                }
                zinheng[1] += 1
                let TimeLeftSec = (100 - LastPercent)/zinheng[0]
                estimatedTime = `${toHHMMSS(TimeLeftSec)} 남음`
            }
            document.getElementById('loading-text').innerText = `${loadingTag}${Number.parseFloat(tt).toFixed(3)}% ${estimatedTime}`
            document.getElementById('loading-text').style.visibility = 'visible'
        }
        else{
            zinheng = [0, 0]
            estimatedTime = ''
            LastTime = ds
            LastPercent = -1.0
            document.getElementById('loading-text').style.visibility = 'hidden'
            loadingTag = ''
        }
    });

    ipcRenderer.on('alert2', async (evn, tt) => {
        const {isDenied} = await Swal.fire({
            icon: 'success',
            showDenyButton: true,
            denyButtonText: "폴더 열기",
            
            title: '완료되었습니다',
        })
        if(isDenied){
            ipcRenderer.send("openFolder", (document.getElementById('folder_input') as HTMLInputElement).value)
        }
    });

    document.getElementById('eztrans').onclick = async () => {
        if(running){
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            })
            return
        }
        const dir = (document.getElementById('folder_input') as HTMLInputElement).value.replaceAll('\\','/')
        ipcRenderer.send('openLLMSettings', { dir: dir, game: 'wolf' });
    }
    ipcRenderer.on('worked', () => {
        running = false
    })

    document.getElementById('settings').onclick = () => {
        if(running){
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            })
            return
        }
        ipcRenderer.send('settings')
        running = true
    }
    
})()