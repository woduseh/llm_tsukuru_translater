import path from 'path';
import { beautifyCodes, beautifyCodes2 } from "../datas";
import type { ExtractConf, ExtractDictEntry, ExtractedDataEntry } from '../types';
import { AppContext } from '../../../appContext';

function obNullSafe(c: unknown){
    return (typeof c === 'object' && c !== undefined && c !== null)
}

function jpathIsMap(jpath: string){
    const name = path.parse(jpath).name
    return (name.length === 6 && name.substring(0,3) === 'Map' && !isNaN(Number(name.substring(3))))
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
        let LenKeys: string[] = []
        let usedEid: number[] = []
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
            if(ctx.useExternMsg){
                if(ctx.externMsgKeys.includes(datobj[d].var)){
                    datobj[d].var = ctx.externMsg[datobj[d].var]
                }
            }
            if(!LenKeys.includes(jpath)){
                LenMemory[jpath] = (ctx.gb[jpath].outputText!.split('\n').length - 1)
                LenKeys.push(jpath)
            }
            if(ctx.settings.formatNice && obNullSafe(datobj[d].conf)){
                if(beautifyCodes.includes(datobj[d].conf!.code!)){
                    const toadd = '==========\n'
                    ctx.gb[jpath].outputText += toadd
                    LenMemory[jpath] += (toadd.split('\n').length - 1)
                }
                const eid = datobj[d].conf!.eid
                if(eid !== undefined && eid !== null){
                    if(!usedEid.includes(eid) && beautifyCodes2.includes(datobj[d].conf!.code!)){
                        const toadd = `//==========//\n`
                        ctx.gb[jpath].outputText += toadd
                        LenMemory[jpath] += (toadd.split('\n').length - 1)
                        usedEid.push(eid)
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
            LenMemory[jpath] += (toadd.split('\n').length - 1)

            ctx.gb[jpath].data[cid].m = LenMemory[jpath]
        }
    }
}
