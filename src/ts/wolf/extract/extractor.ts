import fs from 'fs'
import { extractEvent } from './ext_events.js'
import { wolfExtractMap } from '../parser/Map.js';
import { sleep } from '../../rpgmv/globalutils.js';
import Tools from '../../libs/projectTools';
import { wolfExtractMapPattern } from '../parser/patternBased.js';
import { AppContext } from '../../../appContext';
import type { WolfExtractConfig } from '../types';
import { findFilesWithinRoot, toWolfProjectRelativePath } from '../paths';

export async function extractWolfFolder(
    dataDir: string,
    conf: WolfExtractConfig,
    ctx: AppContext,
    projectRoot: string,
){

    const maps = findFilesWithinRoot(dataDir, '.mps')
    if(maps.length === 0){
        throw new Error(`Wolf Data 폴더에서 .mps 맵 파일을 찾을 수 없습니다: ${dataDir}`)
    }
    ctx.WolfCache = {}
    let patternMode = conf.extPattern
    let i = 0;
    for(const map of maps){
        Tools.setProgress(i,maps.length, 50)
        const buf = fs.readFileSync(map)
        const sourceFile = toWolfProjectRelativePath(projectRoot, map)
        ctx.WolfCache[sourceFile] = buf
        if(patternMode){
            const pa = wolfExtractMapPattern(buf, ctx)
            extractEvent(pa, sourceFile, conf, ctx)

        }
        else{
            const pa = wolfExtractMap(buf, ctx)
            for(const event of pa.events){
                for(const page of event.pages){
                    extractEvent(page.cmd, sourceFile, conf, ctx)
                }
            }
        }
        await sleep(1)
        i += 1

    }
    Tools.setProgress(1,1, 50)
}
