import { writeFileSync, readFileSync } from 'fs'
import zlib from 'zlib'
import {encode, decode} from '@msgpack/msgpack'
import { appCtx } from '../../../appContext';

const WolfExtDataParser = {
    create: (dir:string)=>{
        writeFileSync(dir,zlib.deflateSync(Buffer.from(encode({
            ext: appCtx.WolfExtData,
            cache: appCtx.WolfCache,
            meta: appCtx.WolfMetadata
        }))))
    },
    read:(dir:string) =>{
        const ca =  decode(zlib.inflateSync(readFileSync(dir))) as { ext: extData[]; meta: wolfMetadata; cache: Record<string, Buffer> }
        appCtx.WolfExtData = ca.ext
        appCtx.WolfMetadata = ca.meta
        appCtx.WolfCache = ca.cache
    }
}

export default WolfExtDataParser