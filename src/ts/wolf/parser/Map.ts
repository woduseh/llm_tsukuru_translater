import { WolfMapEvent, WolfParserIo } from "./io";
import { AppContext } from '../../../appContext';

export function wolfExtractMap(data:Buffer, ctx: AppContext){
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
    io.readU4le() // Reserved field
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
    io.readLenStr() // Map metadata
    io.readU4le(); // Tileset identifier
    const width = io.readU4le();
    const height = io.readU4le();
    const eventSize = io.readU4le();
    if (width < 0 || height < 0 || eventSize < 0) throw new Error('Invalid Wolf map dimensions or event count');
    io.skipBytes(width * height * 3 * 4);
    let events:WolfMapEvent[] = [];
    for (let i = 0; i < eventSize; i++) {
      events.push(io.readMapEvent())
    }
    const check3 = io.readU1();
    if (!(check3 == 102)) {
        throw new Error('ValidationNotEqualError')
    }
    return {
        events: events
    }
}
