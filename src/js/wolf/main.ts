import { ipcMain } from "electron";
import path from 'path'
import fs from 'fs'
import { worked } from "../../ipc/shared";
import { extractWolfFolder } from "./extract/extractor";
import makeText from "./extract/makeText";
import { wolfAppyier } from "./apply/applyWolf";
import { getAllFileInDir } from "../../utils";
import { wolfDecrypt } from "./extract/decrypter";
import Tools from '../libs/projectTools';
import { appCtx } from '../../appContext';

export async function wolfInit() {
    ipcMain.on('wolf_ext', async (ev, arg:{folder:string,config:{[key:string]:boolean}}) => {
        try {
          appCtx.WolfMetadata = {
            ver:-1
          }
          let dir = arg.folder
          if(path.parse(dir).name !== 'data'){
            if(fs.existsSync(path.join(dir, 'Data'))){
              dir = path.join(dir, 'Data')
            }
            else if(fs.existsSync(path.join(dir, 'data'))){
              dir = path.join(dir, 'data')
            }
          }
          if(!fs.existsSync(dir)){
            Tools.sendError('지정된 디렉토리가 없습니다');
            worked()
            return
          }
          if((path.parse(dir).name !== 'data' && (!fs.existsSync(path.join(dir, 'Data.wolf')))) && (!arg.config.force)){
            Tools.sendError('data 폴더가 아닙니다');
            worked()
            return
          }

          appCtx.sourceDir  = arg.folder
          appCtx.WolfExtData = []
          const encrypted = getAllFileInDir(path.dirname(dir), '.wolf')
          if(encrypted.length > 0){
            const d = await wolfDecrypt(encrypted)
            if(!d){
              worked()
            }
          }
          if(path.parse(dir).name !== 'data'){
            if(fs.existsSync(path.join(dir, 'Data'))){
              dir = path.join(dir, 'Data')
            }
            else if(fs.existsSync(path.join(dir, 'data'))){
              dir = path.join(dir, 'data')
            }
          }
          await extractWolfFolder(dir, arg.config)
          await makeText()
          Tools.send('alert2');
          worked()
        }
        catch(err){
          Tools.sendError(JSON.stringify(err, Object.getOwnPropertyNames(err)));
        }
    })
    ipcMain.on('wolf_apply',  async (ev, arg:{folder:string,config:{[key:string]:boolean}}) => {
        const dir = arg.folder
        if(!fs.existsSync(dir)){
          Tools.sendError('지정된 디렉토리가 없습니다');
          worked()
          return
        }
        if(path.parse(dir).name !== 'data' && (!arg.config.force)){
          Tools.sendError('data 폴더가 아닙니다');
          worked()
          return
        }
        appCtx.sourceDir  = arg.folder
        appCtx.WolfExtData = []
        await wolfAppyier()
        Tools.send('alert2');
        worked()

    })
}