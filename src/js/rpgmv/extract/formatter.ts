import path from 'path';
import { beautifyCodes, beautifyCodes2 } from "../datas";
import type { ExtractConf, ExtractDictEntry, ExtractedDataEntry } from '../types';
import { AppContext } from '../../../appContext';

function obNullSafe(c: unknown){
    return (typeof c === 'object' && c !== null)
}

export function jpathIsMap(jpath: string){
    const name = path.parse(jpath).name
    return (name.length === 6 && name.substring(0,3) === 'Map' && !isNaN(Number(name.substring(3))))
}

/** Count newline characters in a string without allocating an array. */
function countNewlines(str: string): number {
    let count = 0;
    for(let i = 0; i < str.length; i++){
        if(str.charCodeAt(i) === 10) count++
    }
    return count
}

export const format_extracted = async(dats: {datobj: Record<string, ExtractDictEntry>; edited: Record<string, unknown>; conf: ExtractConf}, typ = 0, ctx: AppContext) => {
    const datobj = dats.datobj
    const conf = dats.conf
    const extended = conf.extended
    const fileName = conf.fileName
    const dir = conf.dir
    if(typ == 0){
        const Keys = Object.keys(datobj)
        let LenMemory: Record<string, number> = {}
        const usedEid = new Set<number>()
        const beautifyCodesSet = new Set(beautifyCodes)
        const beautifyCodes2Set = new Set(beautifyCodes2)
        const externMsgKeySet = ctx.useExternMsg ? new Set(ctx.externMsgKeys) : null
        ctx.gb[fileName].outputText = ''
        for(const d of Keys){
            let jpath = fileName
            if(datobj[d].qpath === 'script' && ctx.settings.onefile_src){
                jpath = 'ext_scripts.json'
            }
            else if(datobj[d].qpath === 'note' && ctx.settings.onefile_note){
                jpath = 'ext_note.json'
            }
            else if(datobj[d].qpath === 'note2' && ctx.settings.onefile_note){
                jpath = 'ext_note2.json'
            }
            else if(datobj[d].qpath === 'javascript' && ctx.settings.onefile_src){
                jpath = 'ext_javascript.json'
            }
            else if(ctx.settings.oneMapFile && jpathIsMap(jpath)){
                jpath = 'Maps.json'
            }
            if(externMsgKeySet !== null){
                if(externMsgKeySet.has(datobj[d].var)){
                    datobj[d].var = ctx.externMsg[datobj[d].var]
                }
            }
            if(!(jpath in LenMemory)){
                LenMemory[jpath] = countNewlines(ctx.gb[jpath].outputText!)
            }
            if(ctx.settings.formatNice && obNullSafe(datobj[d].conf)){
                if(beautifyCodesSet.has(datobj[d].conf!.code!)){
                    ctx.gb[jpath].outputText += '==========\n'
                    LenMemory[jpath] += 1
                }
                const eid = datobj[d].conf!.eid
                if(eid !== undefined && eid !== null){
                    if(!usedEid.has(eid) && beautifyCodes2Set.has(datobj[d].conf!.code!)){
                        ctx.gb[jpath].outputText += `//==========//\n`
                        LenMemory[jpath] += 1
                        usedEid.add(eid)
                    }
                }
            }
            const cid = LenMemory[jpath]
            ctx.gb[jpath].data[cid] = {} as ExtractedDataEntry
            ctx.gb[jpath].data[cid].origin = fileName
            ctx.gb[jpath].data[cid].type = 'None'
            ctx.gb[jpath].data[cid].val = d
            ctx.gb[jpath].data[cid].conf = datobj[d].conf
            ctx.gb[jpath].data[cid].originText = datobj[d].var

            const toadd = datobj[d].var +'\n'

            ctx.gb[jpath].outputText += toadd
            LenMemory[jpath] += countNewlines(toadd)

            ctx.gb[jpath].data[cid].m = LenMemory[jpath]
        }
    }
}
