import { writeFileSync, readFileSync } from 'fs'
import zlib from 'zlib'
import {encode, decode} from '@msgpack/msgpack'
import { FileIOError } from '../../libs/fileIO';
import { AppContext } from '../../../appContext';

const WolfExtDataParser = {
    create: (dir:string, ctx: AppContext)=>{
        try {
            writeFileSync(dir,zlib.deflateSync(Buffer.from(encode({
                ext: ctx.WolfExtData,
                cache: ctx.WolfCache,
                meta: ctx.WolfMetadata
            }))))
        } catch (err) {
            throw new FileIOError(`Wolf 추출 데이터를 쓸 수 없습니다: ${dir}`, dir, 'write', err);
        }
    },
    read:(dir:string, ctx: AppContext) =>{
        try {
            const ca =  decode(zlib.inflateSync(readFileSync(dir))) as { ext: extData[]; meta: wolfMetadata; cache: Record<string, Buffer> }
            ctx.WolfExtData = ca.ext
            ctx.WolfMetadata = ca.meta
            ctx.WolfCache = ca.cache
        } catch (err) {
            throw new FileIOError(`Wolf 추출 데이터를 읽을 수 없습니다: ${dir}`, dir, 'read', err);
        }
    }
}

export default WolfExtDataParser