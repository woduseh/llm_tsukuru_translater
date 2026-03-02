(() => {
    const { ipcRenderer } = window.require('electron');
    const {_} = window.require('lodash');
    let running = false
    let loadingTag = ''
    let menu_open = false
    let globalSettings:{[key:string]:any} = {}
    let LastTime = -1
    let LastPercent = -1.0
    let estimatedTime = ''
    let speedSamples:number[] = []
    const ETA_WINDOW = 10

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

    //@ts-ignore
    const Swal = window.Swal
    
    let config = {
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
    }
    let _mode = -1
    
    document.getElementById('icon1').onclick = () => {ipcRenderer.send('close')}
    document.getElementById('icon2').onclick = () => {ipcRenderer.send('minimize')}
    document.getElementById('fold').onclick = () => {ipcRenderer.send("openFolder", (document.getElementById('folder_input') as HTMLInputElement).value)}
    document.querySelector('#sel').addEventListener('click', () => {
        ipcRenderer.send('select_folder', 'folder_input');
    });

    ipcRenderer.send('setheight', 550);

    
    ipcRenderer.on('set_path', (evn, tt) => {
        (document.getElementById(tt.type) as HTMLInputElement).value = tt.dir
        if(tt.type !== 'folder_input'){
            document.getElementById(tt.type).innerText = tt.dir
        }
    });
    
    
    
    ipcRenderer.on('getGlobalSettings', (evn, tt) => {
        if(tt.language === 'en'){
            
            globalThis.loadEn()
        }
        globalSettings = tt
        const tData = (globalSettings.themeData)
        let root = document.documentElement;
        for(const i in tData){
            root.style.setProperty(i,tData[i]);
        }
    })
    
    ipcRenderer.on('loadingTag', (evn, tt) => {
        loadingTag = tt
    })
    
    ipcRenderer.on('loading', (evn, tt) => {
        document.getElementById('border_r').style.width = `${tt}vw`
        let ds = Math.floor(new Date().getTime()/1000)
        if(tt > 0 && globalSettings.loadingText){
            if(LastTime != ds){
                const ChangedTime = ds - LastTime
                LastTime = ds
                let OldPercent = LastPercent
                LastPercent = parseFloat(tt)
                const movedPercent = (LastPercent - OldPercent) / ChangedTime
                if(movedPercent > 0){
                    speedSamples.push(movedPercent)
                    if(speedSamples.length > ETA_WINDOW) speedSamples.shift()
                }
                if(speedSamples.length > 0){
                    const avgSpeed = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length
                    let TimeLeftSec = (100 - LastPercent) / avgSpeed
                    estimatedTime = `${toHHMMSS(TimeLeftSec)} 남음`
                }
            }
            document.getElementById('loading-text').innerText = `${loadingTag}${loadingTag ? ' · ' : ''}${Number.parseFloat(tt).toFixed(1)}% ${estimatedTime}`
            document.getElementById('loading-text').style.visibility = 'visible'
        }
        else{
            speedSamples = []
            estimatedTime = ''
            LastTime = ds
            LastPercent = -1.0
            document.getElementById('loading-text').style.visibility = 'hidden'
            loadingTag = ''
        }
    });
    
    ipcRenderer.on('worked', () => {running = false})
    
    ipcRenderer.on('check_force', (evn, arg) => {
        Swal.fire({
            icon: 'question',
            text: 'Extract 폴더가 존재합니다. \n덮어씌우겠습니까?',
            confirmButtonText: '예',
            showDenyButton: true,
            denyButtonText: `아니오`,
        }).then((result) => {
            if (result.isConfirmed) {
                arg.force = true
                ipcRenderer.send('extract', arg);
            }
        })
    });
    
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
    
    ipcRenderer.on('alert_free', (evn, tt) => {
        Swal.fire(tt)
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
    
    document.getElementById('WolfBtn').onclick = () => {
        ipcRenderer.send('changeURL', './src/html/wolf/index.html')
    }
    
    function _reload(){
        if(_mode == 0){
            document.getElementById('ext').style.backgroundColor = 'var(--Selected)'
            document.getElementById('ext').style.opacity = '1'
            document.getElementById('ext').style.color = '#fff'
            document.getElementById('apply').style.backgroundColor = ''
            document.getElementById('apply').style.opacity = ''
            document.getElementById('apply').style.color = ''
            if (document.getElementById('c-ext').classList.contains("hiddenc")) {
                document.getElementById('c-ext').classList.remove("hiddenc");}
            if (!document.getElementById('c-app').classList.contains("hiddenc")) {
                document.getElementById('c-app').classList.add("hiddenc");}
        }
        else if(_mode == 1){
            document.getElementById('ext').style.backgroundColor = ''
            document.getElementById('ext').style.opacity = ''
            document.getElementById('ext').style.color = ''
            document.getElementById('apply').style.backgroundColor = 'var(--Selected)'
            document.getElementById('apply').style.opacity = '1'
            document.getElementById('apply').style.color = '#fff'
            if (document.getElementById('c-app').classList.contains("hiddenc")) {
                document.getElementById('c-app').classList.remove("hiddenc");}
            if (!document.getElementById('c-ext').classList.contains("hiddenc")) {
                document.getElementById('c-ext').classList.add("hiddenc");}
        }
        else{
            document.getElementById('ext').style.backgroundColor = ''
            document.getElementById('ext').style.opacity = ''
            document.getElementById('ext').style.color = ''
            document.getElementById('apply').style.backgroundColor = ''
            document.getElementById('apply').style.opacity = ''
            document.getElementById('apply').style.color = ''
        }
        const DomList = ['ext_plugin','ext_note','ext_src','autoline','instantapply','exJson','decryptImg','decryptAudio', 'ext_javascript']
        for(const i in DomList){
            if(config[DomList[i]]){
                document.getElementById(DomList[i]).style.backgroundColor = 'var(--Selected)'
                document.getElementById(DomList[i]).style.color = '#fff'
            }
            else{
                document.getElementById(DomList[i]).style.backgroundColor = ''
                document.getElementById(DomList[i]).style.color = ''
            }
        }
    }
    
    ipcRenderer.on('is_version', (ev, arg)=>{
        globalThis.version = arg
    })
    
    document.getElementById('ext').onclick = () => {_mode=0;_reload()}
    document.getElementById('apply').onclick = () => {_mode=1;_reload()}
    _reload()
    
    if(true){
        menu_open = true
    }

    // LLM translation abort button
    let llmTranslating = false;

    ipcRenderer.on('llmTranslating', (ev, val) => {
        llmTranslating = val;
        document.getElementById('abort-llm-btn').style.display = val ? 'block' : 'none';
    })

    document.getElementById('abort-llm-btn').onclick = async () => {
        const result = await Swal.fire({
            icon: 'warning',
            text: '번역을 중단하시겠습니까?\n현재까지의 진행 상태는 저장됩니다.',
            confirmButtonText: '중단',
            showDenyButton: true,
            denyButtonText: '계속',
        })
        if (result.isConfirmed) {
            ipcRenderer.send('abortLLM');
        }
    }

    // Escape key aborts LLM translation (with confirmation)
    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape' && llmTranslating) {
            const result = await Swal.fire({
                icon: 'warning',
                text: '번역을 중단하시겠습니까?\n현재까지의 진행 상태는 저장됩니다.',
                confirmButtonText: '중단',
                showDenyButton: true,
                denyButtonText: '계속',
            })
            if (result.isConfirmed) {
                ipcRenderer.send('abortLLM');
            }
        }
    })
    
    document.getElementById('ext_plugin').onclick = () => {
        if(!config.ext_plugin){
            Swal.fire({
                icon: 'warning',
                text: '플러그인을 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n번역 시 원어만 번역해 주시고,\n추출 모드에서 RUN을 눌러 추출하세요',
                    })
                    config.ext_plugin = true
                    _reload()
                }
            })
        }
        else{
            config.ext_plugin = false
            _reload()
        }
    }
    
    document.getElementById('decryptImg').onclick = () => {config.decryptImg = !config.decryptImg; _reload()}
    document.getElementById('decryptAudio').onclick = () => {config.decryptAudio = !config.decryptAudio; _reload()}
    
    document.getElementById('exJson').onclick = () => {
        if(!config.exJson){
            Swal.fire({
                icon: 'warning',
                text: '비표준 JSON / CSV를 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n추출 모드에서 RUN을 눌러 추출하세요',
                    })
                    config.exJson = true
                    _reload()
                }
            })
        }
        else{
            config.exJson = false
            _reload()
        }
    }
    
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
    
    document.getElementById('ext_src').onclick = () => {
        if(!config.ext_src){
            Swal.fire({
                icon: 'warning',
                text: '스크립트를 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n번역 시 원어만 번역해 주시고,\n추출 모드에서 RUN을 눌러 추출하세요',
                    })
                    config.ext_src = true
                    _reload()
                }
            })
        }
        else{
            config.ext_src = false
            _reload()
        }
    }
    
    document.getElementById('ext_javascript').onclick = () => {
        if(!config.ext_javascript){
            Swal.fire({
                icon: 'warning',
                text: '자바스크립트를 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n잘못된 곳을 번역하지 않도록 주의하시고,\n추출 모드에서 RUN을 눌러 추출하세요',
                    })
                    config.ext_javascript = true
                    _reload()
                }
            })
        }
        else{
            config.ext_javascript = false
            _reload()
        }
    }
    
    document.getElementById('toProject').onclick = () => {
        if(running){
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            })
            return
        }
        Swal.fire({
            icon: 'warning',
            text: '변환기를 사용하시겠습니까?',
            confirmButtonText: '예',
            showDenyButton: true,
            denyButtonText: `아니오`,
        }).then(async (result) => {
            if (result.isConfirmed) {
                await Swal.fire({
                    icon: "info",
                    text: "프로젝트를 저장할 위치를 선택해주세요"
                })
                running = true
                ipcRenderer.send('projectConvert', (document.getElementById('folder_input') as HTMLInputElement).value)
            }
        })
    }
    
    document.getElementById('ext_note').onclick = () => {
        if(!config.ext_note){
            Swal.fire({
                icon: 'warning',
                text: '노트/메모를 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n번역 시 원어만 번역해 주시고,\n추출 모드에서 RUN을 눌러 추출하세요',
                    })
                    config.ext_note = true
                    _reload()
                }
            })
        }
        else{
            config.ext_note = false
            _reload()
        }
    }
    
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

    document.getElementById('autoline').onclick = () => {config.autoline = !config.autoline;_reload();}
    document.getElementById('instantapply').onclick = () => {config.instantapply = !config.instantapply;_reload();}
    
    document.getElementById('run').onclick = () => {
        if(running){
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            })
            return
        }
        const kas = (document.getElementById('folder_input') as HTMLInputElement).value
        if(_mode == 0){
            const a = {
                dir: Buffer.from(kas.replace('\\','/'), "utf8").toString('base64')
            };
            running = true
            ipcRenderer.send('extract', _.merge({}, a, config));
        }
        else if(_mode == 1){
            const a = {
                dir: Buffer.from(kas.replace('\\','/'), "utf8").toString('base64')
            };
            running = true
            ipcRenderer.send('apply', _.merge({}, a, config));
        }
    }
    
    document.getElementById('eztrans').onclick = async () => {
        if(running){
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            })
            return
        }
        const dir = (document.getElementById('folder_input') as HTMLInputElement).value.replaceAll('\\','/')
        ipcRenderer.send('openLLMSettings', { dir: dir, game: 'mv' });
    }

    document.getElementById('llmCompare').onclick = () => {
        const dir = (document.getElementById('folder_input') as HTMLInputElement).value.replaceAll('\\','/')
        if (!dir) {
            Swal.fire({ icon: 'error', text: '프로젝트 폴더를 먼저 선택하세요.' })
            return
        }
        ipcRenderer.send('openLLMCompare', dir);
    }

    document.getElementById('jsonVerify').onclick = () => {
        const dir = (document.getElementById('folder_input') as HTMLInputElement).value.replaceAll('\\','/')
        if (!dir) {
            Swal.fire({ icon: 'error', text: '프로젝트 폴더를 먼저 선택하세요.' })
            return
        }
        ipcRenderer.send('openJsonVerify', dir);
    }
    
    
    document.getElementById('versionUp').onclick = async () => {
        if(running){
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            })
            return
        }
        if(_mode !== 0){
            Swal.fire({
                icon: 'error',
                text: '추출 모드 상태이여야 합니다!',
            })
            return
        }
        const { isConfirmed: isConfirmed} = await Swal.fire({
            title: '버전 업 툴 주의사항',
            icon: 'warning',
            text: "버전 업 툴 사용 시 추출 모드의 설정 및 옵션이 그대로 적용됩니다. 구버전 번역본의 추출된 데이터를 기반으로 이식되며, 추출된 데이터가 많을 수록 더 많은 데이터가 이식됩니다.만약 구버전 번역본을 추출하였을 때랑 다른 설정 및 옵션을 사용할 시, 예기치 못한 문제가 발생할 수 있습니다.",
            showDenyButton: true,
            denyButtonText: `취소`,
        })
        if(!isConfirmed){
            return
        }
        const { value: formValues } = await Swal.fire({
            title: '버전 업 툴',
            html:
              '<div id="swi1" class="cfolder" placeholder="구버전 번역 data 폴더"'+
              'onclick="ipcRenderer.send(\'select_folder\', \'swi1\')">구버전 번역본 폴더</div>' +
              '<div id="swi3" class="cfolder" placeholder="구버전 미번역 data 폴더"'+
              'onclick="ipcRenderer.send(\'select_folder\', \'swi3\')">구버전 미번역 폴더</div>' +
              '<div id="swi2" class="cfolder" placeholder="신버전 미번역 data 폴더"'+
              'onclick="ipcRenderer.send(\'select_folder\', \'swi2\')">신버전 폴더</div>',
            focusConfirm: false,
            showDenyButton: true,
            denyButtonText: `취소`,
            preConfirm: () => {
              return [
                document.getElementById('swi1').innerText,
                document.getElementById('swi2').innerText,
                document.getElementById('swi3').innerText
              ]
            }
        })
        
        if (formValues) {
            if(!(formValues[0] === '' || formValues[1] === '' || formValues[2] === '' )){
                if(formValues[0] === formValues[1] || formValues[1] === formValues[2] || formValues[0] === formValues[2] ){
                    Swal.fire({icon: 'error',text: '같은 폴더입니다!'})
                }
                else{
                    const kas = formValues[0]
                    const kas2 = formValues[1]
                    const kas3 = formValues[2]
                    const a = {
                        dir1: _.merge({}, {dir: Buffer.from(kas.replace('\\','/'), "utf8").toString('base64')}, config),
                        dir2: _.merge({}, {dir: Buffer.from(kas2.replace('\\','/'), "utf8").toString('base64')}, config),
                        dir3: _.merge({}, {dir: Buffer.from(kas3.replace('\\','/'), "utf8").toString('base64')}, config),
                        dir1_base: kas,
                        dir2_base: kas2,
                        dir3_base: kas3,
                        config: config
                    };
                    running = true
                    ipcRenderer.send('updateVersion', a);
                }
            }
        }
    }
    
    document.getElementById('fontConfig').onclick = async () => {
        if(running){
            Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            })
            return
        }
        await Swal.fire({
            title: '주의사항',
            icon: 'warning',
            text: '폰트 변경/크기 변경은 게임 내 폰트를 즉시 변경합니다.'
        })
        let result = await Swal.fire({
            title: '무엇을 하시겠습니까?',
            icon: 'info',
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: '폰트 변경',
            denyButtonText: `폰트 크기 변경`,
            cancelButtonText: '취소'
        })
        if (result.isConfirmed) {
            running = true
            ipcRenderer.send('selFont', (document.getElementById('folder_input') as HTMLInputElement).value)
        } else if (result.isDenied) {
            let { value: result2 } = await Swal.fire({
                title: '폰트 크기 입력',
                input: 'text',
                inputValue: 24,
                showCancelButton: true,
                inputValidator: (value) => {
                  if (!value) {
                    return '무언가 입력해야 합니다!'
                  }
                  if (isNaN(value)) {
                    return '숫자가 아닙니다!'
                  }
                }
            })
            if(result2){
                running = true
                ipcRenderer.send('changeFontSize', [(document.getElementById('folder_input') as HTMLInputElement).value, parseInt(result2)])
            }
    
        }
    }
})()