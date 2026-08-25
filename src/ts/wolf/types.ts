export interface lenStr {
    pos1: number
    pos2: number
    pos3: number
    str: Uint8Array
    len: number
}

export interface wolfMetadata {
    ver: 2 | 3 | -1
}

export interface WolfExtractConfig {
    extPattern?: boolean
    extBuran?: boolean
    extAll?: boolean
}

export interface extData {
    str: lenStr
    sourceFile: string
    extractFile: string
    endsWithNull: boolean
    textLineNumber: number[]
    codeStr: string
}
