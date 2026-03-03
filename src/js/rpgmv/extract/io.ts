import csv from '@fast-csv/parse';
import encoding from 'encoding-japanese';
import { writeToPath } from '@fast-csv/format';
import { DecryptDir as DecryptDirs, EncryptDir as EncryptDirs } from '../fileCrypto';
import type { ExtractArg } from '../types';
import { resetHadComment } from './parser';

export const init_extract = (arg: ExtractArg) => {
    resetHadComment()
    function c(fileName: string){
        globalThis.gb[fileName] = {data: {}}
        globalThis.gb[fileName].outputText = ''
        globalThis.gb[fileName].isbom = false 
    }
    if(globalThis.settings.onefile_src && arg.ext_src){
        c('ext_scripts.json')
    }
    if(globalThis.settings.onefile_src && arg.ext_javascript){
        c('ext_javascript.json')
    }
    if(globalThis.settings.onefile_note && arg.ext_note){
        c('ext_note.json')
        c('ext_note2.json')
    }
    if(globalThis.settings.oneMapFile){
        c('Maps.json')
    }
}

export const parse_externMsg = (dir: string, useI: boolean) => {
    return new Promise((resolve, reject) => {
        let a: Record<string, string> = {}
        csv.parseFile(dir, {encoding: "binary"})
        .on('data', (row) => {
            function Convert(txt: unknown){
                if(txt === undefined || txt === null){
                    return ''
                }
                const bf = Buffer.from(txt as string, "binary")
                const Utf8Array = new Uint8Array(encoding.convert(bf, 'UTF8', 'AUTO'));
                return new TextDecoder().decode(Utf8Array)
            }
            if(useI){
                a[`\\M[${Convert(row[0])}]`] = Convert(row[1])
            }
            else{
                a[Convert(row[0])] = Convert(row[1])
            }
        })
        .on('end', () => {
            resolve(a)
        })
    })
}

export const pack_externMsg = (dir:string, data: Record<string, string>) => {
    return new Promise<void>((resolve, reject) => {
        let rows = []
        for(const i in data){
            rows.push([i, data[i]])
        }
        writeToPath(dir, rows)
        .on('error', err => console.error(err))
        .on('finish', () => resolve());
    })
}

export const DecryptDir = DecryptDirs

export const EncryptDir = EncryptDirs
