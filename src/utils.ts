import path from 'path'
import fs from 'fs'

const shiftJisDecoder = new TextDecoder('shift_jis');

export function decodeEncoding(buffer:Uint8Array, wolfMetadata: { ver: 2 | 3 | -1 }){
    if(wolfMetadata.ver === 2){
        return shiftJisDecoder.decode(buffer)
    }
    else{
        return Buffer.from(buffer).toString('utf-8')
    }
}

export function getAllFileInDir(Directory:string, ext:null|string = null) {
    let Files:string[] = [];

    function ThroughDirectory(Directory: string) {
        fs.readdirSync(Directory).forEach(File => {
            const Absolute = path.join(Directory, File);
            if (fs.statSync(Absolute).isDirectory()){
                ThroughDirectory(Absolute);
                return
            }
            else{
                if(ext){
                    if(path.extname(Absolute) === ext){
                        Files.push(Absolute);
                    }
                }
                else{
                    Files.push(Absolute);
                }
                return
            }
        });
    }

    ThroughDirectory(Directory);
    return Files
}