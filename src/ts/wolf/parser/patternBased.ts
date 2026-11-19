import { lenStr } from "../../../../globals"
import { WolfCmd, WolfParserIo } from "./io"
import { AppContext } from '../../../appContext';
import { MAX_ARG_COUNT, MAX_COMMAND_ID } from './constants'
import { createEventLoopSlicer } from '../../libs/eventLoopSlice'

type ScanResult = { cmd: WolfCmd } | { failedAt: number }

function scanCommandAt(data: Buffer, start: number): ScanResult {
    const end = data.length
    let p = start
    const fail = (): ScanResult => ({ failedAt: p })

    p += 1
    if (p > end) return fail()
    const numArgLen = data[start]
    if (numArgLen <= 0 || numArgLen >= MAX_ARG_COUNT) return fail()
    const argsEnd = p + numArgLen * 4
    if (argsEnd > end) return { failedAt: argsEnd }
    const commandId = data.readInt32LE(p)
    p = argsEnd
    if (commandId >= MAX_COMMAND_ID || commandId < 0) return fail()
    const numArg: number[] = [commandId]
    for (let offset = start + 5; offset < argsEnd; offset += 4) numArg.push(data.readInt32LE(offset))
    p += 1
    if (p > end) return fail()
    p += 1
    if (p > end) return fail()
    const strArgLen = data[p - 1]
    if (strArgLen <= 0 || strArgLen >= MAX_ARG_COUNT) return fail()
    const strArg: lenStr[] = []
    for (let i = 0; i < strArgLen; i++) {
        const pos1 = p
        p += 4
        if (p > end) return fail()
        const len = data.readInt32LE(pos1)
        const pos2 = p
        if (len > end - p) return fail()
        if (len <= 0 || data[pos2 + len - 1] !== 0) {
            p = pos2 + len
            return fail()
        }
        p = pos2 + len
        strArg.push({ pos1, pos2, pos3: p, str: data.subarray(pos2, p), len })
    }
    p += 1
    if (p > end) return fail()
    const hasMoveRoute = data[p - 1]
    if (hasMoveRoute !== 0 && hasMoveRoute !== 1) return fail()
    return { cmd: { numArg, strArg } }
}

export async function wolfExtractMapPattern(data:Buffer, ctx: AppContext): Promise<WolfCmd[]>{
    const io = new WolfParserIo(data)
    const magic = io.readBytes(20)
    if (!io.byteArrayCompare(magic, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87, 79, 76, 70, 77, 0, 85, 0, 0, 0])){
        if(io.byteArrayCompare(magic,[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87, 79, 76, 70,77, 0, 0,  0,  0,  0])){
            ctx.WolfMetadata.ver = 2
        }
        else{
            throw new Error('Unvalid 1')
        }
    }
    else{
        ctx.WolfMetadata.ver = 3
    }
    io.readU4le()
    const check = io.readU1()
    if(ctx.WolfMetadata.ver === 2){
        if (!(check == 101)) {
            throw new Error('Unvalid 2')
        }
    }
    else{
        if (!(check == 102)) {
            throw new Error('Unvalid 2')
        }
    }
    io.readLenStr()
    io.readU4le();
    const width = io.readU4le();
    const height = io.readU4le();
    io.readU4le();
    io.skipBytes(Math.max(0, width * height * 3) * 4)

    const source = io.data
    const blen = source.length
    const events:WolfCmd[] = [];
    const yieldIfDue = createEventLoopSlicer()
    for (let currentPoint = io.pointer; currentPoint < blen; currentPoint++) {
        const result = scanCommandAt(source, currentPoint)
        if ('cmd' in result) events.push(result.cmd)
        else if (result.failedAt >= blen) break
        if ((currentPoint & 0xffff) === 0) await yieldIfDue()
    }
    return events
}
