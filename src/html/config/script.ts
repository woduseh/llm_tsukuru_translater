let gsettings: Record<string, any> = {}
const CheckboxValues = [
  'ExtractAddLine',
  'onefile_src',
  'onefile_note',
  'JsonChangeLine',
  'extractSomeScript',
  'oneMapFile',
  'loadingText',
  'ExternMsgJson',
  'DoNotTransHangul',
  'formatNice'
]

window.api.on("settings", (arg: unknown) => {
  try{
    gsettings = arg as Record<string, any>
    const ess2 = gsettings.extractSomeScript2 as string[]
    const extractPlus = gsettings.extractPlus as number[]
    if(gsettings.language === 'en'){
      globalThis.loadEn()
    }
  
    (document.getElementById('extractSomeScript2') as HTMLTextAreaElement).value += ess2.join('\n');
    (document.getElementById('extractPlus') as HTMLTextAreaElement).value += extractPlus.map(String).join('\n');
    CheckboxValues.forEach((val) => {
      (document.getElementById(val) as HTMLInputElement).checked = gsettings[val]
    })

    // LLM settings
    ;(document.getElementById('llmApiKey') as HTMLInputElement).value = gsettings.llmApiKey || '';
    (document.getElementById('llmModel') as HTMLInputElement).value = gsettings.llmModel || 'gemini-3.0-flash-preview';
    (document.getElementById('llmSourceLang') as HTMLSelectElement).value = gsettings.llmSourceLang || 'ja';
    (document.getElementById('llmTargetLang') as HTMLSelectElement).value = gsettings.llmTargetLang || 'ko';
    (document.getElementById('llmTranslationUnit') as HTMLSelectElement).value = gsettings.llmTranslationUnit || 'file';
    (document.getElementById('llmChunkSize') as HTMLInputElement).value = String(gsettings.llmChunkSize || 30);
    (document.getElementById('llmMaxRetries') as HTMLInputElement).value = String(gsettings.llmMaxRetries ?? 2);
    (document.getElementById('llmMaxApiRetries') as HTMLInputElement).value = String(gsettings.llmMaxApiRetries ?? 5);
    (document.getElementById('llmTimeout') as HTMLInputElement).value = String(gsettings.llmTimeout ?? 600);
    (document.getElementById('llmCustomPrompt') as HTMLTextAreaElement).value = gsettings.llmCustomPrompt || '';
    updateChunkSizeVisibility()

    document.getElementById('license')!.onclick = () => {window.api.send('license')}
    _reload()
  }
  catch(e){
    alert(e)
  }
})

function _reload(){
  if(gsettings.extractSomeScript){
    document.getElementById('extractSomeScript2')!.className = ''
  }
  else{
    document.getElementById('extractSomeScript2')!.className = 'invisible'
  }
}

function updateChunkSizeVisibility(){
  const unit = (document.getElementById('llmTranslationUnit') as HTMLSelectElement).value;
  (document.getElementById('chunkSizeGroup') as HTMLElement).style.display = unit === 'file' ? 'none' : '';
}

document.getElementById('llmTranslationUnit')!.addEventListener('change', updateChunkSizeVisibility)

document.getElementById('extractSomeScript')!.addEventListener('change', (event) => {
  gsettings.extractSomeScript = (document.getElementById('extractSomeScript') as HTMLInputElement).checked
  _reload()
})

document.getElementById('apply')!.onclick = () => {
  CheckboxValues.forEach((val) => {
    gsettings[val] = (document.getElementById(val) as HTMLInputElement).checked
  })
  gsettings.theme = 'Dracula'
  gsettings.extractSomeScript2 = (document.getElementById('extractSomeScript2') as HTMLTextAreaElement).value.split('\n')

  const extractPlusValues = (document.getElementById('extractPlus') as HTMLTextAreaElement).value.split('\n')
  let extP = []
  for(const val of extractPlusValues){
    const tn = parseInt(val)
    if(!isNaN(tn)){
      extP.push(tn)
    }
  }
  gsettings.extractPlus = extP

  // LLM settings
  gsettings.llmApiKey = (document.getElementById('llmApiKey') as HTMLInputElement).value;
  gsettings.llmModel = (document.getElementById('llmModel') as HTMLInputElement).value;
  gsettings.llmSourceLang = (document.getElementById('llmSourceLang') as HTMLSelectElement).value;
  gsettings.llmTargetLang = (document.getElementById('llmTargetLang') as HTMLSelectElement).value;
  gsettings.llmTranslationUnit = (document.getElementById('llmTranslationUnit') as HTMLSelectElement).value;
  gsettings.llmChunkSize = parseInt((document.getElementById('llmChunkSize') as HTMLInputElement).value) || 30;
  gsettings.llmMaxRetries = parseInt((document.getElementById('llmMaxRetries') as HTMLInputElement).value) ?? 2;
  gsettings.llmMaxApiRetries = parseInt((document.getElementById('llmMaxApiRetries') as HTMLInputElement).value) ?? 5;
  gsettings.llmTimeout = parseInt((document.getElementById('llmTimeout') as HTMLInputElement).value) || 600;
  gsettings.llmCustomPrompt = (document.getElementById('llmCustomPrompt') as HTMLTextAreaElement).value;

  window.api.send('applysettings', gsettings);
}

document.getElementById('close')!.onclick = () => {
  window.api.send('closesettings', gsettings);
}