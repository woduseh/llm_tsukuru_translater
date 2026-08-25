import { execFile } from "child_process";
import path from "path";
import { checkExtention, ExtentionPath } from "../../libs/extentions";
import Tools from '../../libs/projectTools';
import { AppContext } from '../../../appContext';
import {
    decryptInitialWolfArchives,
    type WolfArchiveDecryptor,
    type WolfInitialDecryptTarget,
} from './decryptSequence';

const Decrypter = path.join(ExtentionPath, 'wolfdec.exe')

function decryptFileWithWolfDec(file:string) {
    return new Promise<void>((resolve, reject) => {
        const d = execFile(Decrypter, [file], {cwd: path.dirname(file)})
        d.once('error', reject)
        d.once('close', (code, signal) => {
            if(code === 0){
                resolve()
                return
            }
            reject(new Error(`WolfDec 복호화 실패: ${path.basename(file)} (code=${code ?? 'null'}, signal=${signal ?? 'none'})`))
        })
    })
}

export async function wolfDecrypt(
    files:string[],
    ctx: AppContext,
    target: WolfInitialDecryptTarget,
    decryptFile: WolfArchiveDecryptor = decryptFileWithWolfDec,
) {
    if(await checkExtention('wolfdec', ctx)){
        Tools.send('loadingTag', `복호화 중`);
        let completed = 0;
        try {
            await decryptInitialWolfArchives(files, target, async (file) => {
                Tools.setProgress(completed, files.length)
                await decryptFile(file)
                completed += 1
            })
            Tools.setProgress(files.length, files.length)
            return true
        } finally {
            Tools.send('loadingTag', ``);
        }
    }
    else{
        return false
    }
}
