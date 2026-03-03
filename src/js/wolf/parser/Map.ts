import { WolfCmd, WolfMapEvent, WolfParserIo } from "./io";
import { appCtx } from '../../../appContext';

export function wolfExtractMap(data:Buffer){
    const io = new WolfParserIo(data)
    const magic = io.readBytes(20)
    if (!io.byteArrayCompare(magic, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87, 79, 76, 70, 77, 0, 85, 0, 0, 0])){
        if(io.byteArrayCompare(magic,[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87, 79, 76, 70,77, 0, 0,  0,  0,  0])){
            appCtx.WolfMetadata.ver = 2
        }
        else{
            throw 'Unvalid 1'
        }
    }
    else{
        appCtx.WolfMetadata.ver = 3
    }
    const len = io.readU4le()
    const check = io.readU1()
    if(appCtx.WolfMetadata.ver === 2){
        if (!(check == 101)) {
            throw 'Unvalid 2'
        }
    }
    else{
        if (!(check == 102)) {
            throw 'Unvalid 2'
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
    let events:WolfMapEvent[] = [];
    for (let i = 0; i < eventSize; i++) {
      events.push(io.readMapEvent())
    }
    const check3 = io.readU1();
    if (!(check3 == 102)) {
        throw 'ValidationNotEqualError'
    }
    return {
        events: events
    }
}

export function wolfExtractCommon(data:Buffer){
    const io = new WolfParserIo(data)
    const magic = io.readBytes(10)
    if (!io.byteArrayCompare(magic, [0, 87, 0, 0, 79, 76, 85, 70, 67,  0])){
        if(io.byteArrayCompare(magic, [0, 87,  0,  0, 79,76,  0, 70, 67,  0])){

        }
        else{
        }
    }
    const check = io.readU1();
    if (!(check === 144)) {
        if(check === 143){
            appCtx.WolfMetadata.ver = 2
        }
    }
    else{
        appCtx.WolfMetadata.ver = 3
    }
    const eventsLen = io.readU4le();
    let events:WolfCmd[] = [];
    for (let i = 0; i < eventsLen; i++) {
        try {
            const ev = io.readCEvent()
            if(ev){
                for(const e of ev.events){
                    events.push(e)
                }
            }
            else{
                break
            }   
        } catch (error) {
            break
        }
    }
    return events
}