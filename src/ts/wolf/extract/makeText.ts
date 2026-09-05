import fs from 'fs'
import path from 'path'
import { performance } from 'node:perf_hooks';
import { decodeEncoding } from '../../../utils'
import { sleep } from '../../rpgmv/globalutils';
import Tools from '../../libs/projectTools';
import { writeTextFile } from '../../libs/fileIO';
import WolfExtDataParser from './wolfExtData'
import { AppContext } from '../../../appContext';


function setProgressBar(now:number, max:number, multipl=50){
    Tools.send('loading', 50 + ((now/max) * multipl));
}

export default async function makeText(ctx: AppContext, extractRoot: string){
    const ext = ctx.WolfExtData
    let texts:{[key:string]:string[]} = {}
    let sliceStarted = 0
    for(let i =0;i<ext.length;i++){
        // Yield real event-loop time for IPC without a timer and progress event
        // for every string. A single large string can exceed this work budget.
        if(i === 0 || performance.now() - sliceStarted >= 8){
            setProgressBar(i,ext.length)
            await sleep(0)
            sliceStarted = performance.now()
        }
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
    replaceDirectoryFromStaging(extractRoot, (stagingRoot) => {
        const textsRoot = path.join(stagingRoot, 'Texts')
        fs.mkdirSync(textsRoot)

        for(const key in texts){
            writeTextFile(path.join(textsRoot,`${key}.txt`), texts[key].join('\n'))
        }
        WolfExtDataParser.create(path.join(stagingRoot, '.extracteddata'), ctx)
    })
    Tools.send('loading', 0);
}

export function replaceDirectoryFromStaging(
    targetDir: string,
    populate: (stagingDir: string) => void,
): void {
    const resolvedTarget = path.resolve(targetDir)
    const parent = path.dirname(resolvedTarget)
    const baseName = path.basename(resolvedTarget)
    fs.mkdirSync(parent, { recursive: true })
    const stagingDir = fs.mkdtempSync(path.join(parent, `.${baseName}.staging-`))
    const previousDir = path.join(parent, `.${baseName}.previous-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`)
    let previousMoved = false
    let committed = false

    try {
        populate(stagingDir)
        if(fs.existsSync(resolvedTarget)){
            fs.renameSync(resolvedTarget, previousDir)
            previousMoved = true
        }
        try {
            fs.renameSync(stagingDir, resolvedTarget)
            committed = true
        } catch (error) {
            if(previousMoved && !fs.existsSync(resolvedTarget)){
                try {
                    fs.renameSync(previousDir, resolvedTarget)
                    previousMoved = false
                } catch (restoreError) {
                    throw new Error(`Wolf 추출 폴더 교체와 기존 폴더 복구에 실패했습니다: ${(error as Error).message}; restore: ${(restoreError as Error).message}`)
                }
            }
            throw error
        }
    } finally {
        if(!committed && fs.existsSync(stagingDir)){
            fs.rmSync(stagingDir, { recursive: true, force: true })
        }
        if(committed && previousMoved && fs.existsSync(previousDir)){
            try {
                fs.rmSync(previousDir, { recursive: true, force: true })
            } catch (error) {
                console.warn('Wolf 이전 추출 폴더 정리에 실패했습니다:', previousDir, error)
            }
        }
    }
}
