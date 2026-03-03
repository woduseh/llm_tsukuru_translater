import { execFile } from "child_process";
import { removeSync } from "fs-extra";
import path from "path";
import { checkExtention, ExtentionPath } from "../../libs/extentions";
import Tools from '../../libs/projectTools';

const Decrypter = path.join(ExtentionPath, 'wolfdec.exe')

function DecryptFile(file:string) {
    return new Promise<void>((resolve) => {
        const d = execFile(Decrypter, [file], {cwd: path.dirname(file)})
        d.on('exit', () => {
            removeSync(file)
            resolve()
        })
    })
}


export async function wolfDecrypt(files:string[]) {
    if(await checkExtention('wolfdec')){
        Tools.send('loadingTag', `복호화 중`);
        let i=0;
        for(const file of files){
            Tools.setProgress(i, files.length)
            await DecryptFile(file)
            i+=1
        }
        Tools.send('loadingTag', ``);
        return true
    }
    else{
        return false
    }
}