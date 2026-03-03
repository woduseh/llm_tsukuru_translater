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
import { AppContext } from '../../appContext';

export function registerWolfHandlers(ctx: AppContext) {
    ipcMain.on('wolf_ext', async (ev, arg:{folder:string,config:{[key:string]:boolean}}) => {
        try {
          ctx.WolfMetadata = {
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
            worked(ctx)
            return
          }
          if((path.parse(dir).name !== 'data' && (!fs.existsSync(path.join(dir, 'Data.wolf')))) && (!arg.config.force)){
            Tools.sendError('data 폴더가 아닙니다');
            worked(ctx)
            return
          }

          ctx.sourceDir  = arg.folder
          ctx.WolfExtData = []
          const encrypted = getAllFileInDir(path.dirname(dir), '.wolf')
          if(encrypted.length > 0){
            const d = await wolfDecrypt(encrypted, ctx)
            if(!d){
              worked(ctx)
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
          await extractWolfFolder(dir, arg.config, ctx)
          await makeText(ctx)
          Tools.send('alert2');
          worked(ctx)
        }
        catch(err){
          Tools.sendError(JSON.stringify(err, Object.getOwnPropertyNames(err)));
          worked(ctx)
        }
    })
    ipcMain.on('wolf_apply',  async (ev, arg:{folder:string,config:{[key:string]:boolean}}) => {
      try {
        const dir = arg.folder
        if(!fs.existsSync(dir)){
          Tools.sendError('지정된 디렉토리가 없습니다');
          worked(ctx)
          return
        }
        if(path.parse(dir).name !== 'data' && (!arg.config.force)){
          Tools.sendError('data 폴더가 아닙니다');
          worked(ctx)
          return
        }
        ctx.sourceDir  = arg.folder
        ctx.WolfExtData = []
        await wolfAppyier(ctx)
        Tools.send('alert2');
        worked(ctx)
      } catch(err){
        Tools.sendError(JSON.stringify(err, Object.getOwnPropertyNames(err)));
        worked(ctx)
      }
    })
}