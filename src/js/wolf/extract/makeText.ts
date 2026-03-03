import fs from 'fs'
import path from 'path'
import { decodeEncoding } from '../../../utils'
import { sleep } from '../../rpgmv/globalutils';
import Tools from '../../libs/projectTools';
import { writeTextFile } from '../../libs/fileIO';
import WolfExtDataParser from './wolfExtData'
import { AppContext } from '../../../appContext';


function setProgressBar(now:number, max:number, multipl=50){
    Tools.send('loading', 50 + ((now/max) * multipl));
}

export default async function makeText(ctx: AppContext){
    const ext = ctx.WolfExtData
    let texts:{[key:string]:string[]} = {}
    for(let i =0;i<ext.length;i++){
        setProgressBar(i,ext.length)
        await sleep(1)
        let decoded = (decodeEncoding(ext[i].str.str, ctx.WolfMetadata)).replaceAll('\\','\\\\')
        if(decoded.endsWith('\0')){
            decoded = decoded.substring(0,decoded.length-1)
            ctx.WolfExtData[i].endsWithNull = true
        }

        const text = decoded.split('\n')
        ctx.WolfExtData[i].textLineNumber = []

        if(!texts[ext[i].extractFile]){
            texts[ext[i].extractFile] = []
        }
        texts[ext[i].extractFile].push(`--- ${ext[i].codeStr} ---`)

        for(const txt of text){
            texts[ext[i].extractFile].push(txt)
            ctx.WolfExtData[i].textLineNumber.push(texts[ext[i].extractFile].length-1)
        }
    }
    const extTextDir = path.join(ctx.sourceDir, '_Extract')
    if(fs.existsSync(extTextDir)){
        fs.rmSync(extTextDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extTextDir)
    fs.mkdirSync(path.join(extTextDir, 'Texts'))

    for(const key in texts){
        writeTextFile(path.join(extTextDir, 'Texts',`${key}.txt`), texts[key].join('\n'))
    }
    Tools.send('loading', 0);
    WolfExtDataParser.create(path.join(extTextDir, '.extracteddata'), ctx)
}