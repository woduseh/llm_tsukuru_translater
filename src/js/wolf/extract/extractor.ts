import path from 'path'
import fs from 'fs'
import { extractEvent } from './ext_events.js'
import { wolfExtractCommon, wolfExtractMap } from '../parser/Map.js';
import { getAllFileInDir } from '../../../utils.js';
import { sleep } from '../../rpgmv/globalutils.js';
import Tools from '../../libs/projectTools';
import { wolfDecrypt } from './decrypter.js';
import { wolfExtractMapPattern } from '../parser/patternBased.js';
import { appCtx } from '../../../appContext';

export async function extractWolfFolder(DataDir:string, conf:{[key:string]:boolean}){

    const maps = (getAllFileInDir(DataDir, '.mps'))
    const commonEvent = (path.join(DataDir, 'BasicData','CommonEvent.dat'))
    appCtx.WolfCache = {}
    let patternMode = conf.extPattern
    let i = 0;
    for(const map of maps){
        Tools.setProgress(i,maps.length, 50)
        try {
            const buf = fs.readFileSync(map)
            appCtx.WolfCache[map] = buf
            if(patternMode){
                const pa = wolfExtractMapPattern(buf)
                extractEvent(pa, map, conf)

            }
            else{
                const pa = wolfExtractMap(buf)
                for(const event of pa.events){
                    for(const page of event.pages){
                        extractEvent(page.cmd, map, conf)
                    }
                }
            }
        } catch (error) { console.warn('Wolf map extraction failed:', map, error) }
        await sleep(1)
        i += 1

    }
    Tools.setProgress(1,1, 50)
}