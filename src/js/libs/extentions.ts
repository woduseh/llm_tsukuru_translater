import axios from "axios";
import crypto from "crypto";
import { app, ipcMain } from "electron";
import { existsSync, mkdir, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { sleep } from "../rpgmv/globalutils";
import { appCtx } from '../../appContext';

// TODO: populate with actual hash after first verified download
const WOLFDEC_SHA256 = '';


let gExt = false
let acceptedExt = false
export const ExtentionPath = path.join(app.getPath('userData'), 'Ext')
export function initExtentions(){
    if(!existsSync(app.getPath('userData'))){
        mkdirSync(app.getPath('userData'))
    }
    if(!existsSync(ExtentionPath)){
        mkdirSync(ExtentionPath)
    }
    ipcMain.on('getextention', async (ev, arg) => {
        acceptedExt = true
        switch(arg){
            case 'wolfdec':{
                try {
                    const v = Buffer.from((await axios.get('https://github.com/Sinflower/WolfDec/releases/download/v0.3/WolfDec.exe', {
                        responseType: 'arraybuffer'
                    })).data)
                    const hash = crypto.createHash('sha256').update(v).digest('hex')
                    console.log(`WolfDec.exe SHA-256: ${hash}`)
                    if (WOLFDEC_SHA256 && hash !== WOLFDEC_SHA256) {
                        console.error(`WolfDec.exe hash mismatch: expected ${WOLFDEC_SHA256}, got ${hash}`)
                        appCtx.mainWindow!.webContents.send('alert', 'WolfDec.exe download integrity check failed. The file may be corrupted or tampered with.')
                        acceptedExt = false
                        break
                    }
                    const filePath = path.join(ExtentionPath, 'wolfdec.exe')
                    writeFileSync(filePath, v)
                } catch (e: unknown) {
                    console.error('Failed to download WolfDec.exe:', (e as Error).message || e)
                    appCtx.mainWindow!.webContents.send('alert', 'Failed to download WolfDec.exe. Please check your internet connection.')
                    acceptedExt = false
                }
                break
            }
            case 'none':{
                acceptedExt = false
            }
        }

        gExt = true
    })
}

export async function checkExtention(param:'wolfdec') {
    const isInstalled = param === 'wolfdec' ? existsSync(path.join(ExtentionPath, 'wolfdec.exe')) : null
    const parKo = {
        'wolfdec': '복호화'
    }
    const parEn = {
        'wolfdec': 'Decryption'
    }

    if(!isInstalled){
        if(appCtx.settings.language === 'ko'){
            appCtx.mainWindow!.webContents.send('alertExten', [`${parKo[param]}에는 확장 설치가 필요합니다. 설치하시겠습니까?`,param])
        }
        else{
            appCtx.mainWindow!.webContents.send('alertExten', [`${parEn[param]} requires an extension installation. Do you want to install it?`,param])
        }
        gExt = false
        while(!gExt){
            await sleep(10)
        }
        return acceptedExt
    }
    else{
        return true
    }
}