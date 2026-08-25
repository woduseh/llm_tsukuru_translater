import { ipcMain } from "electron";
import { worked } from "../../ipc/shared";
import { extractWolfFolder } from "./extract/extractor";
import makeText from "./extract/makeText";
import { wolfAppyier } from "./apply/applyWolf";
import { wolfDecrypt } from "./extract/decrypter";
import Tools from '../libs/projectTools';
import { AppContext } from '../../appContext';
import type { WolfExtractConfig } from './types';
import { findWolfArchivesForInitialDecrypt, resolveWolfProjectPaths } from './paths';

export function registerWolfHandlers(ctx: AppContext) {
    ipcMain.on('wolf_ext', async (_ev, arg:{folder:string,config?:WolfExtractConfig}) => {
        try {
          ctx.WolfMetadata = {
            ver:-1
          }
          const initialPaths = resolveWolfProjectPaths(arg.folder, { allowEncryptedProject: true })
          ctx.sourceDir = initialPaths.projectRoot
          ctx.WolfExtData = []
          ctx.WolfCache = {}
          const encrypted = findWolfArchivesForInitialDecrypt(initialPaths)
          if(encrypted.length > 0){
            const d = await wolfDecrypt(encrypted, ctx, initialPaths)
            if(!d){
              return
            }
          }
          const paths = resolveWolfProjectPaths(initialPaths.projectRoot)
          await extractWolfFolder(paths.dataDir, arg.config ?? {}, ctx, paths.projectRoot)
          await makeText(ctx, paths.extractRoot)
          Tools.send('alert2');
        }
        catch(err){
          Tools.sendError(JSON.stringify(err, Object.getOwnPropertyNames(err)));
        } finally {
          worked(ctx)
        }
    })
    ipcMain.on('wolf_apply',  async (_ev, arg:{folder:string}) => {
      try {
        const paths = resolveWolfProjectPaths(arg.folder)
        ctx.sourceDir = paths.projectRoot
        ctx.WolfExtData = []
        await wolfAppyier(ctx, paths)
        Tools.send('alert2');
      } catch(err){
        Tools.sendError(JSON.stringify(err, Object.getOwnPropertyNames(err)));
      } finally {
        worked(ctx)
      }
    })
}
