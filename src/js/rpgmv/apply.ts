import fs from 'fs';
import * as  ExtTool from './extract/index.js';
import path from 'path';
import * as edTool from './edtool.js';
import yaml from 'js-yaml';
import { sleep } from './globalutils';
import Tools from '../libs/projectTools';

import type { ApplyArg } from './types';

function getBinarySize(string: string) {
    return Buffer.byteLength(string, 'utf8');
}
export const apply = async (ev: unknown, arg: ApplyArg) => {
    try {
      const dir = (Buffer.from(arg.dir, "base64").toString('utf8'));
      if (! fs.existsSync(dir + '/Extract')){
        Tools.sendError('Extract 폴더가 존재하지 않습니다');
        Tools.worked();
        return
      }
      if (!edTool.exists(dir)){
        Tools.sendError('.extracteddata 파일이 존재하지 않습니다');
        Tools.worked();
        return
      }
      if(!arg.instantapply){
        if (fs.existsSync(dir + '/.Completed')){
          fs.rmSync(dir + '/Completed', { recursive: true })
        }
        if (!fs.existsSync(dir + '/.Completed')){
          fs.mkdirSync(dir + '/Completed/data', { recursive: true })
          fs.mkdirSync(dir + '/Completed/js', { recursive: true })
        }
      }
      const jsdir = ((dir.substring(0,dir.length-5) + '/js').replaceAll('//','/'))
      let ext_data = edTool.read(dir)
      const ext_dat = ext_data.main
      const max_files = Object.keys(ext_dat).length
      let worked_files = 0
      let OutputData: Record<string, any> = {}
      for(const i of Object.keys(ext_dat)){
        if(fs.existsSync(dir + '/Backup/' + i)){
          let filedata = fs.readFileSync(dir + '/Backup/' + i, 'utf8')
          if (filedata.charCodeAt(0) === 0xFEFF) {
            filedata = filedata.substring(1);
          }
          try {
            OutputData[i] = JSON.parse(filedata)  
          } catch (error) { console.warn('Failed to parse backup file:', i, error) }
        }
      }
      for(const i of Object.keys(ext_dat)){
        worked_files += 1
        if(i.includes('.json')){
          let fname = (i === 'ext_javascript.json') ? dir + '/Extract/ext_javascript.js' : dir + '/Extract/' + path.parse(i).name + '.txt'
          let Edata = fs.readFileSync(fname, 'utf8').split('\n')
          for(const q of Object.keys(ext_dat[i].data)){
            let output = ''
            let autoline = false
            let autolineSize = 0
            let originFile = ext_dat[i].data[q].origin ?? i
            if(ext_dat[i].data[q].conf !== undefined){
                const econf = ext_dat[i].data[q].conf
                if(arg.autoline && econf.type == 'event' && econf.code == 401){
                    autoline = true
                    autolineSize = econf.face ? 80 : 60
                }
                if(arg.isComment){
                  continue
                }
            }
            for(let x=parseInt(q);x<ext_dat[i].data[q].m;x++){
              let forUse = Edata[x]
              if(autoline && (getBinarySize(forUse) > autolineSize)){
                  let v = forUse.split(' ')
                  if(v.length > 0){
                    v[(Math.floor(v.length/2)) - 1] = '\n' + v[(Math.floor(v.length/2)) - 1]
                  }
                  forUse = v.join(' ')
              }
              output += forUse
              if(x !== (ext_dat[i].data[q].m - 1)){
                output += '\n'
              }
            }
            try {
              if(!Object.keys(OutputData).includes(originFile)){
                const fidir = path.join(dir, 'Backup', originFile)
                if(fs.existsSync(fidir)){
                  let filedata = fs.readFileSync(fidir, 'utf8')
                  if (filedata.charCodeAt(0) === 0xFEFF) {
                    filedata = filedata.substring(1);
                  }
                  try {
                    OutputData[originFile] = JSON.parse(filedata)
                  } catch (error) {}
                }
              }
              OutputData[originFile] = ExtTool.setObj(ext_dat[i].data[q].val, output, OutputData[originFile]) 
            } catch (error) { console.warn('Failed to set value for:', ext_dat[i].data[q].val, error) }
          }
        }
        Tools.send('loading', worked_files/max_files*100);
        await sleep(0)
      }

      for(const i of Object.keys(OutputData)){
        const data = OutputData[i]
        if(i == 'ext_plugins.json'){
          const vaq = `var $plugins = ${JSON.stringify(data)};`
          if(arg.instantapply){
            fs.writeFileSync(jsdir + '/plugins.js', vaq,'utf8')
          }
          else{
            fs.writeFileSync(dir + '/Completed/js/plugins.js', vaq,'utf8')
          }
        }
        else if(i == 'ExternMsgcsv.json'){
          if(arg.instantapply){
            await ExtTool.pack_externMsg(dir + '/ExternMessage.csv', data)
          }
          else{
            await ExtTool.pack_externMsg(dir + '/Completed/data/ExternMessage.csv', data)
          }
        }
        else{
          const fdir = arg.instantapply ? path.join(dir, i) : path.join(dir,'Completed','data',i)
          const fdir2 = arg.instantapply ? path.join(dir, `${i}.yaml`) : path.join(dir,'Completed','data', `${i}.yaml`)
          const fd = arg.useYaml ? fdir2 : fdir
          const dataJson = arg.useYaml ? yaml.dump(data) : JSON.stringify(data, null, 4*Number(globalThis.settings.JsonChangeLine))
          fs.writeFileSync(fd, dataJson,'utf8')
          if(arg.useYaml && fs.existsSync(fdir)){
            fs.rmSync(fdir)
          }
          else if((!arg.useYaml) && fs.existsSync(fdir2)){
            fs.rmSync(fdir2)
          }
        }
      }
      
      await ExtTool.EncryptDir(dir, 'img', !!arg.instantapply)
      await ExtTool.EncryptDir(dir, 'audio', !!arg.instantapply)

      Tools.send('alert2');
      Tools.send('loading', 0);
    } catch (err) {
      Tools.sendError(JSON.stringify(err, Object.getOwnPropertyNames(err)));
    }
    Tools.worked();
}