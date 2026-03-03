import { BrowserWindow } from "electron"
import { AppSettings } from "./src/types/settings"

export declare global {
    var mwindow:BrowserWindow
    var settings:AppSettings
    var settingsWindow:BrowserWindow
    var keyvalue:CryptoKey|undefined
    var oPath:string
    var sourceDir:string
    var iconPath:string
    var gb:{[key:string]: any}
    var externMsg:{[key:string]: any}
    var useExternMsg:boolean
    var externMsgKeys:string[]
    var llmAbort:boolean
    var loadEn:() => void
    var WolfExtData: extData[]
    var WolfEncoding:'utf8'|'shift-jis'
    var WolfCache: {[key:string]:Buffer}
    var WolfMetadata: wolfMetadata

    interface Window {
        api: {
            send: (channel: string, ...args: any[]) => void;
            on: (channel: string, callback: (...args: any[]) => void) => any;
            once: (channel: string, callback: (...args: any[]) => void) => void;
            removeAllListeners: (channel: string) => void;
            invoke: (channel: string, ...args: any[]) => Promise<any>;
        };
        nodeBuffer: {
            toBase64: (str: string) => string;
            fromBase64: (str: string) => string;
        };
        nodeFs: {
            readFileSync: (filePath: string, encoding: string) => string;
            readdirSync: (dirPath: string) => string[];
            existsSync: (filePath: string) => boolean;
            writeFileSync: (filePath: string, data: string, encoding: string) => void;
        };
        nodePath: {
            join: (...args: string[]) => string;
            parse: (p: string) => { root: string; dir: string; base: string; ext: string; name: string };
            basename: (p: string) => string;
        };
        Swal: any;
        verify: {
            verifyJsonIntegrity: (orig: any, trans: any) => any[];
            repairJson: (orig: any, trans: any) => any;
        };
    }
}

interface wolfMetadata{
    ver:2|3|-1
}

interface extData{
    str:lenStr
    sourceFile:string
    extractFile:string
    endsWithNull:boolean
    textLineNumber:number[]
    codeStr:string


}

export interface lenStr{
    pos1:number
    pos2:number
    pos3:number
    str:Uint8Array
    len:number
}