import { lenStr } from "../../../../globals"
import { WolfCmd, WolfMapEvent, WolfParserIo } from "./io"
import { AppContext } from '../../../appContext';
import { MAX_ARG_COUNT, MAX_COMMAND_ID } from './constants'

export function wolfExtractMapPattern(data:Buffer, ctx: AppContext){
    const io = new WolfParserIo(data)
    const magic = io.readBytes(20)
    if (!io.byteArrayCompare(magic, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87, 79, 76, 70, 77, 0, 85, 0, 0, 0])){
        if(io.byteArrayCompare(magic,[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87, 79, 76, 70,77, 0, 0,  0,  0,  0])){
            ctx.WolfMetadata.ver = 2
        }
        else{
            throw new Error('Unvalid 1')
        }
    }
    else{
        ctx.WolfMetadata.ver = 3
    }
    const len = io.readU4le()
    const check = io.readU1()
    if(ctx.WolfMetadata.ver === 2){
        if (!(check == 101)) {
            throw new Error('Unvalid 2')
        }
    }
    else{
        if (!(check == 102)) {
            throw new Error('Unvalid 2')
        }
    }
    const unk = io.readLenStr()
    const tilesetId = io.readU4le();
    const width = io.readU4le();
    const height = io.readU4le();
    const eventSize = io.readU4le();
    let map:number[] = []
    for (let i = 0; i < ((width * height) * 3); i++) {
        map.push(io.readU4le());
    }


    //find Event Pattern Based
    let currentPoint = io.pointer
    let events:WolfCmd[] = [];
    const blen = data.length
    while(currentPoint < blen){
        try {
            io.pointer = currentPoint
            const numArgLen = io.readU1();
            let numArg:number[] = [];
            if(numArgLen <= 0){
                throw new Error('nein')
            }
            if(numArgLen >= MAX_ARG_COUNT){
                throw new Error('nein')
            }
            for (let i = 0; i < numArgLen; i++) {
              numArg.push(io.readU4le());
            }
            if((numArg[0] >= MAX_COMMAND_ID) || (numArg[0] < 0) ){
                throw new Error('nein')
            }
            const indent = io.readU1();
            const strArgLen = io.readU1();
            if(strArgLen <= 0){
                throw new Error('nein')
            }
            if(strArgLen >= MAX_ARG_COUNT){
                throw new Error('nein')
            }
            let strArg:lenStr[] = [];
            for (let i = 0; i < strArgLen; i++) {
                const str = io.readLenStr()
                if(str.str[str.len-1] === 0){
                    strArg.push(str)
                }
                else{
                    throw new Error('nein2')
                }
            }
            const hasMoveRoute = io.readU1();
            if (!( ((hasMoveRoute == 0) || (hasMoveRoute == 1)) )) {
              throw new Error("ValidationNotAnyOfError")
            }
            events.push({
                numArg: numArg,
                strArg: strArg
            })
        } catch (error) {
            if(io.pointer >= blen){
                break
            }
            if(currentPoint >= blen){
                break
            }
        }
        if(currentPoint % 10000 === 0){
        }
        currentPoint += 1
    }
    return events
}