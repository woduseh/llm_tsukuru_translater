import { VerifyIssue } from "./src/ts/rpgmv/verify"

export declare global {
    interface Window {
        api: {
            send: (channel: string, ...args: unknown[]) => void;
            on: (channel: string, callback: (...args: any[]) => void) => unknown;
            once: (channel: string, callback: (...args: any[]) => void) => void;
            removeAllListeners: (channel: string) => void;
            invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
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
        Swal: any;  // third-party SweetAlert2, no type defs
        verify: {
            verifyJsonIntegrity: (orig: unknown, trans: unknown) => VerifyIssue[];
            repairJson: (orig: unknown, trans: unknown) => unknown;
            getAtPath: (obj: unknown, jsonPath: string) => unknown;
            setAtPath: (obj: unknown, jsonPath: string, value: unknown) => boolean;
        };
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
}

export interface lenStr{
    pos1:number
    pos2:number
    pos3:number
    str:Uint8Array
    len:number
}