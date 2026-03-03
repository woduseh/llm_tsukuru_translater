import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import * as ExtTool from '../js/rpgmv/extract.js';
import * as edTool from '../js/rpgmv/edtool.js';
import * as dataBaseO from '../js/rpgmv/datas.js';
import { checkIsMapFile, sleep } from '../js/rpgmv/globalutils.js';
import * as yaml from 'js-yaml';
import { getMainWindow, sendError, worked } from './shared';

const ErrorAlert = (msg: any) => sendError(msg)

export async function extractor(arg: any){
  try {
    globalThis.gb = {}
    let file
    let v
    const extended = true
    if(!arg.silent){
      arg.silent = false
    }
    const dir = Buffer.from(arg.dir, "base64").toString('utf8');
    if(!fs.existsSync(dir)){
      getMainWindow().webContents.send('alert', {icon: 'error', message: '지정된 디렉토리가 없습니다'}); 
      worked()
      return
    }
    if(path.parse(dir).name !== 'data' && (!arg.force)){
      getMainWindow().webContents.send('alert', {icon: 'error', message: 'data 폴더가 아닙니다'}); 
      worked()
      return
    }
    if(fs.existsSync(dir + '/Extract')){
      if(!arg.force){
        getMainWindow().webContents.send('check_force', arg); 
        worked()
        return
      }
      else{
        fs.rmSync(dir + '/Extract', { recursive: true });
        if(fs.existsSync(dir + '/Backup')){
          fs.rmSync(dir + '/Backup', { recursive: true });
        }
      }
    }
    if(arg.ext_plugin){
        let jsdir = ((dir.substring(0,dir.length-5) + '/js').replaceAll('//','/'))
        if(!fs.existsSync(jsdir + '/plugins.js')){
          jsdir = path.join(path.dirname(path.dirname(path.dirname(jsdir))), 'js')
          if(!fs.existsSync(jsdir + '/plugins.js')){
            getMainWindow().webContents.send('alert', {icon: 'error', message: 'plugin.js가 존재하지 않습니다'}); 
            worked()
            return
          }
        }
        let hail2 = fs.readFileSync(jsdir + '/plugins.js', 'utf-8')
        let hail = hail2.split('$plugins =')
        hail2 = hail[hail.length - 1] + '  '
        hail2 = hail2.substring(hail2.indexOf('['), hail2.lastIndexOf(']') + 1)
        fs.writeFileSync(dir + '/ext_plugins.json', JSON.stringify(JSON.parse(hail2)), 'utf-8')
    }
    globalThis.externMsg = {}
    globalThis.useExternMsg = false
    if(fs.existsSync(dir + '/ExternMessage.csv') && arg.exJson && globalThis.settings.ExternMsgJson){
      const Emsg = await ExtTool.parse_externMsg(dir + '/ExternMessage.csv', !globalThis.settings.ExternMsgJson) as any
      globalThis.externMsg = Emsg
      if(globalThis.settings.ExternMsgJson){
        fs.writeFileSync(dir + '/ExternMsgcsv.json', JSON.stringify(Emsg, null, 4), 'utf-8')
      }
      else{
        globalThis.useExternMsg = true
        globalThis.externMsgKeys = Object.keys(Emsg)
      }
    }
    let tempjsons: string[] = []
    const fileList2 = fs.readdirSync(dir)
    for(const i in fileList2){
      const f = path.join(dir, fileList2[i])
      const pf = path.parse(f)
      if(f.endsWith('.json.yaml')){
        const fname = path.join(pf.dir, pf.name)
        const fd = JSON.stringify(yaml.load(fs.readFileSync(f, 'utf-8')))
        fs.writeFileSync(fname, fd, 'utf-8')
        tempjsons.push(fname)
      }
    }

    const fileList = fs.readdirSync(dir)

    if (! fs.existsSync(dir + '/Extract')){
      fs.mkdirSync(dir + '/Extract')
    }
    if (! fs.existsSync(dir + '/Backup')){
      fs.mkdirSync(dir + '/Backup')
    }
    const onebyone = dataBaseO.onebyone

    const max_files = fileList.length
    let worked_files = 0
    ExtTool.init_extract(arg)
    for (const i in fileList){
      worked_files += 1
      const fileName = fileList[i]
      if(path.parse(fileName).ext != '.json'){
        continue
      }
      const conf = {
        extended: extended,
        fileName: fileName,
        dir: dir,
        srce: arg.ext_src,
        autoline: arg.autoline,
        note: arg.ext_note,
        arg: arg
      }
      let runBackup = async () => {
        try {
          fs.copyFileSync(dir + '/' + fileName, dir + '/Backup/' + fileName) 
        } catch (error) { console.error('Backup failed for', fileName, error) }
      }
      runBackup()
      if (checkIsMapFile(fileName)){
        file = fs.readFileSync(dir + '/' + fileName, 'utf8')
        await ExtTool.format_extracted(await ExtTool.extract(file, conf, 'map'))
      }
      else if (Object.keys(onebyone).includes(fileName)){
        file = fs.readFileSync(dir + '/' + fileName, 'utf8')
        await ExtTool.format_extracted(await ExtTool.extract(file, conf, (onebyone as Record<string, string>)[fileName]))
      }
      else if (arg.exJson){
        if(!dataBaseO.ignores.includes(fileName)){
          file = fs.readFileSync(dir + '/' + fileName, 'utf8')
          await ExtTool.format_extracted(await ExtTool.extract(file, conf, 'ex'))
        }
      }
      getMainWindow().webContents.send('loading', worked_files/max_files*100);
      await sleep(0)
    }
    const gbKeys = {...Object.keys(globalThis.gb)}
    for (const i in gbKeys){
      const fileName = gbKeys[i]
      if(globalThis.gb[fileName].outputText === ''){
        delete globalThis.gb[fileName]
      }
      else if(fileName === 'ext_javascript.json'){
        fs.writeFileSync(dir + `/Extract/${path.parse(fileName).name}.js`, globalThis.gb[fileName].outputText,'utf-8')
        delete globalThis.gb[fileName].outputText
      }
      else{
        fs.writeFileSync(dir + `/Extract/${path.parse(fileName).name}.txt`, globalThis.gb[fileName].outputText,'utf-8')
        delete globalThis.gb[fileName].outputText
      }
    }
    const ext_data = {
      main: globalThis.gb
    }
    edTool.write(dir, ext_data)
    if (fs.existsSync(dir + '/ext_plugins.json')){
      fs.rmSync(dir + '/ext_plugins.json')
    }
    if (fs.existsSync(dir + '/ExternMsgcsv.json')){
      fs.rmSync(dir + '/ExternMsgcsv.json')
    }
    for(const i in tempjsons){
      fs.rmSync(tempjsons[i])
    }
    getMainWindow().webContents.send('loading', 0);
    ['img','audio'].forEach((type) => {
      const ExtractImgDir = path.join(dir, `Extract_${type}`)
      if(fs.existsSync(ExtractImgDir)){
        fs.rmSync(ExtractImgDir, { recursive: true, force: true });
      }
    })
    if(arg.decryptImg){
      await ExtTool.DecryptDir(dir, "img")
    }
    if(arg.decryptAudio){
      await ExtTool.DecryptDir(dir, "audio")
    }
    if(!arg.silent){
      getMainWindow().webContents.send('alert2'); 
    }
  } catch (err) {
    getMainWindow().webContents.send('alert', {icon: 'error', message: JSON.stringify(err, Object.getOwnPropertyNames(err))}); 
  }
}

ipcMain.on('extract', async (ev, arg) => {
  await extractor(arg)
  worked()
})

ipcMain.on('updateVersion', async (ev, arg) => {
  function endThis(){
    worked()
  }
  try {
    if(!fs.existsSync(path.join(arg.dir1_base, 'Extract'))){
      ErrorAlert('구버전 번역본의 Extract 폴더가 존재하지 않습니다')
      worked()
      return
    }
    
    await extractor({
      ...arg.dir3,
      dir: Buffer.from(path.join(arg.dir3_base), "utf8").toString('base64'),
      force: true,
      silent: true
    })
    await extractor({
      ...arg.dir2,
      dir: Buffer.from(path.join(arg.dir2_base), "utf8").toString('base64'),
      force: true,
      silent: true
    })
    const TranslatedDir = path.join(arg.dir1_base, 'Extract')
    const OldDir = path.join(arg.dir3_base, 'Extract')
    const NewDir = path.join(arg.dir2_base, 'Extract')
    const fileList1 = fs.readdirSync(OldDir)
    for(let i in (fileList1)){
      const parsed = path.parse(fileList1[i])
      const file = parsed.name.concat(parsed.ext)
      let TransDict: Record<string, string> = {}
      const dat1 = fs.readFileSync(path.join(OldDir, file), 'utf-8').split('\n')
      if(!((fs.existsSync(path.join(TranslatedDir, file))))){
        ErrorAlert('구버전의 번역본 파일과 미번역본 파일이 서로 통하지 않습니다. ')
        endThis()
        return
      }
      const dat0 = fs.readFileSync(path.join(TranslatedDir, file), 'utf-8').split('\n')
      let dat2 = fs.readFileSync(path.join(NewDir, file), 'utf-8')
      let dat2_dat = dat2.split('\n')
      function UpReplacer(data: any, source: any, to: any, all=false){
        for(let i =0;i<data.length;i++){
          if(data[i] === source){
            data[i] = to;
            if(!all){
              break
            }
          }
        }
        return data
      }
      for(let i2 in (dat0)){
        TransDict[dat1[i2]] = dat0[i2]
        dat2_dat = UpReplacer(dat2_dat, dat1[i2], dat0[i2], false)
      }
      for(let i2 in TransDict){
        dat2_dat = UpReplacer(dat2_dat, (dat1 as any)[i2], (dat0 as any)[i2], true)
      }
      dat2 = dat2_dat.join('\n')
      fs.writeFileSync(path.join(NewDir, file), dat2, 'utf-8')




      getMainWindow().webContents.send('loading', Number(i)/fileList1.length*100);
      await sleep(0)
    }
    getMainWindow().webContents.send('alert', '완료되었습니다')
    endThis()
  } catch (err) {
    getMainWindow().webContents.send('alert', {icon: 'error', message: JSON.stringify(err, Object.getOwnPropertyNames(err))}); 
    endThis()
  }
})
