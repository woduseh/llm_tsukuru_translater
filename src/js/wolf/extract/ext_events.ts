import { lenStr } from '../../../../globals'
import { appCtx } from '../../../appContext';

interface Commands{
    numArg:number[]
    strArg:lenStr[]
}

let idIndex = 0
function addString(str:lenStr, sourceFile:string, targetFile:string, codeStr:string = ''){
    const id = idIndex;
    idIndex += 1;
    appCtx.WolfExtData.push({
        str: {
            pos1: str.pos1,
            pos2: str.pos2,
            pos3: str.pos3,
            str: str.str,
            len: str.len
        },
        sourceFile: sourceFile,
        extractFile: targetFile,
        endsWithNull: false,
        textLineNumber: [],
        codeStr: codeStr
    })
}

export function extractEvent(cmds:Commands[], file:string, conf:{[key:string]:boolean}, conf2:{[key:string]:boolean} = {}){
    for(const cmd of cmds){
        const type = (cmd.numArg[0]) //Type
        switch (type){
            case 101:
            case 102:
            case 106:
            case 105:
            case 103:{
                let i = 0;
                for(const str of cmd.strArg){
                    if(conf2.commonevent){
                        addString(str, file, 'commonEvent', `${type}-${i}`)
                    }
                    else{
                        addString(str, file, 'map', `${type}-${i}`)
                    }
                    i += 1
                }
                break
            }
            case 122:
            case 150:{
                // external Extraction
                if(conf.extBuran){
                    let i = 0;
                    for(const str of cmd.strArg){
                        addString(str, file, 'external', `${type}-${i}`)
                        i += 1
                    }
                    break
                }
            }
            default:{
                if(cmd.strArg.length > 0){
                    if(conf.extAll){
                        let i = 0;
                        for(const str of cmd.strArg){
                            addString(str, file, 'external', `${type}-${i}`)
                            i += 1
                        }
                        break
                    }
                }
            }
        }
    }
}