import fs from 'fs';
import zlib from 'zlib'
import iconv from 'iconv-lite'
import path from 'path';
import { validateExtractedData } from '../libs/metadataValidation';

export function read(dir: string){ 
    const filePath = path.join(dir, '.extracteddata')
    try {
        const readF = fs.readFileSync(filePath)
        let data: unknown = JSON.parse(iconv.decode(zlib.inflateSync(readF), 'utf8'))
        while(true){
            if(typeof data === 'object' && data !== null && !Array.isArray(data) && 'main' in data){
                return validateExtractedData(data)
            }
            if(typeof data === 'object' && data !== null && !Array.isArray(data) && 'dat' in data){
                data = (data as Record<string, unknown>).dat
                continue
            }
            throw new Error('missing "main" property')
        }
    } catch (error) {
        throw new Error(`Invalid .extracteddata: ${(error as Error).message}`)
    }
}

export function write(dir: string, ext_data: Object){
    const d = iconv.encode(JSON.stringify({dat: ext_data}), 'utf8')
    const filePath = path.join(dir, '.extracteddata')
    const tempPath = path.join(
        dir,
        `..extracteddata.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
    )
    let descriptor: number | undefined
    try {
        descriptor = fs.openSync(tempPath, 'wx')
        fs.writeFileSync(descriptor, zlib.deflateSync(d))
        fs.fsyncSync(descriptor)
        fs.closeSync(descriptor)
        descriptor = undefined
        fs.renameSync(tempPath, filePath)
    } catch (error) {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor) } catch { /* preserve the original error */ }
        }
        if (fs.existsSync(tempPath)) {
            try { fs.rmSync(tempPath) } catch { /* preserve the original error */ }
        }
        throw error
    }
}

export function exists (dir: string){
    return fs.existsSync(path.join(dir, '.extracteddata'))
}
