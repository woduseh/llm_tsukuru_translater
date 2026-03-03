import path from 'path'
import fs from 'fs'
import { extractEvent } from './ext_events.js'
import { wolfExtractCommon, wolfExtractMap } from '../parser/Map.js';
import { getAllFileInDir } from '../../../utils.js';
import { sleep } from '../../rpgmv/globalutils.js';
import Tools from '../../libs/projectTools';
import { wolfDecrypt } from './decrypter.js';
import { wolfExtractMapPattern } from '../parser/patternBased.js';
import { AppContext } from '../../../appContext';

export async function extractWolfFolder(DataDir:string, conf:{[key:string]:boolean}, ctx: AppContext){

    const maps = (getAllFileInDir(DataDir, '.mps'))
    const commonEvent = (path.join(DataDir, 'BasicData','CommonEvent.dat'))
    ctx.WolfCache = {}
    let patternMode = conf.extPattern
    let i = 0;
    for(const map of maps){
        Tools.setProgress(i,maps.length, 50)
        try {
            const buf = fs.readFileSync(map)
            ctx.WolfCache[map] = buf
            if(patternMode){
                const pa = wolfExtractMapPattern(buf, ctx)
                extractEvent(pa, map, conf, ctx)

            }
            else{
                const pa = wolfExtractMap(buf, ctx)
                for(const event of pa.events){
                    for(const page of event.pages){
                        extractEvent(page.cmd, map, conf, ctx)
                    }
                }
            }
        } catch (error) { console.warn('Wolf map extraction failed:', map, error) }
        await sleep(1)
        i += 1

    }
    Tools.setProgress(1,1, 50)
}