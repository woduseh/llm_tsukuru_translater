import { lenStr } from "../../../../globals"
import {
    EVENT_START_MARKER, EVENT_SENTINEL, EVENT_END_MARKER,
    PAGE_START_MARKER, PAGE_END_MARKER,
    COMMON_EVENT_START, COMMON_EVENT_MAGIC, MAX_STRUCTURE_BYTES,
    COMMON_EVENT_SECTION_A, COMMON_EVENT_SECTION_B,
    COMMON_EVENT_SECTION_C, COMMON_EVENT_SECTION_D,
    CPO_VAR_NAMES_COUNT
} from './constants'

export class WolfParserIo{
    data:Buffer
    pointer:number = 0
    readonly byteLen:number
    constructor(data:Buffer){
        this.data = Buffer.from(data)
        this.byteLen = data.byteLength
    }
    readBytes(bytes:number){
        const arr = this.data.subarray(this.pointer, this.pointer + bytes)
        this.pointer += bytes
        return arr
    }
    byteCompare(equals:Uint8Array){
        const byt = this.data.subarray(this.pointer, this.pointer + equals.length)
        return byt.equals(equals)
    }
    byteArrayCompare(data:Buffer, equals:number[]){
        const comp = Buffer.from(new Uint8Array(equals))
        return comp.equals(data)
    }
    findByteArray(equals:number[]){
        const byt =  new Uint8Array(equals)
        while(this.pointer + byt.length <= this.byteLen){
            if(this.byteCompare(byt)){
                return this.pointer
            }
            this.pointer += 1
        }
        throw new Error('Pattern not found in buffer')
    }
    readU4le(){
        const bytes = 4
        const arr = this.data.subarray(this.pointer, this.pointer + bytes)
        this.pointer += bytes
        return arr.readInt32LE()
    }
    readU1(){
        const bytes = 1
        const arr = this.data.subarray(this.pointer, this.pointer + bytes)
        this.pointer += bytes
        return arr.readUInt8()
    }
    readLenStr():lenStr{
        const pos1 = (this.pointer);
        const len = this.readU4le();
        const pos2 = (this.pointer);
        if(len > (this.byteLen - this.pointer)){
            throw new Error('Overflow Pointer Error')
        }

        const str = this.readBytes(len);
        const pos3 = (this.pointer);
        return {
            pos1: pos1,
            pos2: pos2,
            pos3: pos3,
            str: str,
            len: len
        }
    }
    readMapEvent():WolfMapEvent{
        const check1 = this.readU1();
        if (!(check1 === EVENT_START_MARKER)) {
          throw new Error('ValidationNotEqualError')
        }
        const check2 = this.readU4le();
        if (!(check2 === EVENT_SENTINEL)) {
          throw new Error('ValidationNotEqualError')
        }
        const eventId = this.readU4le();
        const name = this.readLenStr()
        const x = this.readU4le();
        const y = this.readU4le();
        const pageLen = this.readU4le();
        const unkLen = this.readU4le();
        const unk = this.readBytes(unkLen);
        let pages:WolfPage[] = [];
        for (let i = 0; i < pageLen; i++) {
          pages.push(this.readEventPage());
        }
        const check3 = this.readU1();
        if (!(check3 == EVENT_END_MARKER)) {
          throw new Error('ValidationNotEqualError')
        }
        return {
            eventId: eventId,
            name: name,
            x: x,
            y: y,
            pages: pages
        }
    }

    readCmd():WolfCmd{
        const numArgLen = this.readU1();
        let numArg:number[] = [];
        for (let i = 0; i < numArgLen; i++) {
          numArg.push(this.readU4le());
        }
        const indent = this.readU1();
        const strArgLen = this.readU1();
        let strArg:lenStr[] = [];
        for (let i = 0; i < strArgLen; i++) {
          strArg.push(this.readLenStr());
        }
        const hasMoveRoute = this.readU1();
        if (!( ((hasMoveRoute == 0) || (hasMoveRoute == 1)) )) {
          throw new Error("ValidationNotAnyOfError")
        }
        if (hasMoveRoute >= 1) {
            const moveRoute = this.readMoveRoute()
        }
        return {
            numArg: numArg,
            strArg: strArg
        }
    }

    readMoveRoute(){
        const moveRouteType = ({
            DONT_MOVE: 0,
            CUSTOM: 1,
            RANDOM: 2,
            TOWARD_HERO: 3,
      
            0: "DONT_MOVE",
            1: "CUSTOM",
            2: "RANDOM",
            3: "TOWARD_HERO",
        
        })
        const animSpeed = this.readU1();
        const moveSpeed = this.readU1();
        const moveFreq = this.readU1();
        const type = this.readU1();
        const options = this.readRouteOptions()
        const customRouteOptions = this.readRouteOptions()
        const routeLen = this.readU4le();
        let routes:WolfRoute[] = [];
        for (let i = 0; i < routeLen; i++) {
            routes.push(this.readRoute());
        }
        return routes
    }

    readRoute():WolfRoute{
        const type = this.readU1();
        const u4ArgLen = this.readU1();
        let u4Arg:number[] = [];
        for (let i = 0; i < u4ArgLen; i++) {
            u4Arg.push(this.readU4le());
        }
        const u1ArgLen = this.readU1();
        let u1Arg:number[] = [];
        for (let i = 0; i < u1ArgLen; i++) {
            u1Arg.push(this.readU1());
        }
        return {
            type: type,
            u1Arg: u1Arg,
            u4Arg: u4Arg
        }
    }

    readRouteOptions(){
        const flag = this.readU1();
        return {flag:flag}
    }

    readEventPage():WolfPage{
        const check = this.readU1();
        if (!(check === PAGE_START_MARKER)) {
          throw new Error('ValidationNotEqualError')
        }
        const graphic = this.readEventGraphic()
        const cond = this.readEventCond()
        const moveRoute = this.readMoveRoute();
        const cmdLen = this.readU4le();
        let cmd:WolfCmd[] = [];
        for (let i = 0; i < cmdLen; i++) {
          cmd.push(this.readCmd());
        }
        const unkLen = this.readU4le();
        const unk = this.readBytes(unkLen);
        const check2 = this.readU1();
        if (!(check2 === PAGE_END_MARKER)) {
          throw new Error('ValidationNotEqualError')
        }
        return {
            cmd: cmd,
        }
    }

    readEventGraphic(){
        const unk = this.readU4le();
        const graphicName = this.readLenStr()
        const graphicDirection = this.readU1();
        const graphicFrame = this.readU1();
        const graphicOpacity = this.readU1();
        const graphicRenderMode = this.readU1();
        return {
            unk: unk,
            graphicName: graphicName,
            graphicDirection: graphicDirection,
            graphicFrame: graphicFrame,
            graphicOpacity: graphicOpacity,
            graphicRenderMode: graphicRenderMode
        }
    }

    readEventCond(){
        const type = this.readU1();
        let flags:{ flag: number; }[] = [];
        for (let i = 0; i < 4; i++) {
          flags.push(this.readRouteOptions())
        }
        let lets:number[] = [];
        for (let i = 0; i < 4; i++) {
          lets.push(this.readU4le());
        }
        let values:number[] = [];
        for (let i = 0; i < 4; i++) {
          values.push(this.readU4le());
        }
    }

    readCEvent(){
        const checka = this.readU1();
        if (!(checka === COMMON_EVENT_START)) {
          throw new Error(`ValidationNotEqualError ${checka} 1 `)
        }
        const id = this.readU4le();
        const runCond = this.readU1();
        const c = this.readU4le();
        if (!(c === COMMON_EVENT_MAGIC)) {
            return false
            // throw `ValidationNotEqualError ${c} 2 `
        }
        const d = this.readU4le();
        if (!(d === 0)) {
            return false
            // throw `ValidationNotEqualError ${d} 3 `
        }
        const enabledNumArgNum = this.readU1();
        const enabledStrArgNum = this.readU1();
        const name = this.readLenStr();
        const len = this.readU4le();
        let ins:WolfCmd[] = [];
        for (let i = 0; i < len; i++) {
            const inst = this.readCInstruction()
            if(inst){
              if(inst === 'trident'){
                return {events:ins}
              }
              else{
                ins.push(inst);
              }
            }
        }
        const noteLen = this.readU4le();
        const unk = this.readBytes(noteLen);
        if (noteLen >= 1) {
          const note = this.readLenStr();
        }
        const check = this.readU1();
        if (!( ((check === COMMON_EVENT_START) || (check === COMMON_EVENT_SECTION_A) || (check === COMMON_EVENT_SECTION_B)) )) {
        }
        if (check !== COMMON_EVENT_START) {
          const hmm = this.readHmm()
        }
        return {events: ins}
    }

    readCInstruction(){
        let monitor = true
        const u8ArgLen = this.readU1();
        let u8Arg:number[] = [];
        for (let i = 0; i < u8ArgLen; i++) {
          u8Arg.push(this.readU4le());
        }
        const indent = this.readU1();
        const strArgLen = this.readU1();
        let strArg:lenStr[] = [];
        for (let i = 0; i < strArgLen; i++) {
          const st = this.readLenStr()
          strArg.push(st);
          if(st.str[st.len-1] !== 0){
            return 'trident'
          }
        }
        const l4 = this.readU1();
        if (l4 >= 1) {
          const l5 = this.readBytes(6);
        }
        if (l4 >= 1) {
          const l6 = this.readU4le();
          if (l6 <= MAX_STRUCTURE_BYTES) {
            const l7 = this.readKuku()
          }
        }
        return {numArg:u8Arg, strArg: strArg}
    }
    readKuku(){
        const ku1 = this.readU1();
        const ku2Len = this.readU1();
        let ku2:number[] = [];
        for (let i = 0; i < ku2Len; i++) {
          ku2.push(this.readU4le());
        }
        const ku3Len = this.readU1();
        const ku3 = this.readBytes(ku3Len);
    }
    readHmm(){
      const argNamesLen = this.readU4le();
      let argNames:lenStr[] = [];
      for (let i = 0; i < argNamesLen; i++) {
        argNames.push(this.readLenStr());
      }
      const typeLen = this.readU4le();
      let types:number[] = [];
      for (let i = 0; i < typeLen; i++) {
        types.push(this.readU1());
      }
      const argSpecialStrDataLen = this.readU4le();
      let argSpecialStrData:lenStr[][] = [];
      for (let i = 0; i < argSpecialStrDataLen; i++) {
        argSpecialStrData.push(this.readArgSpecialStrData());
      }
      const argSpecialNumDataLen = this.readU4le();
      let argSpecialNumData:number[][] = [];
      for (let i = 0; i < argSpecialNumDataLen; i++) {
        argSpecialNumData.push(this.readArgSpecialNumData());
      }
      const argDefaultLen = this.readU4le();
      let argDefault:number[] = [];
      for (let i = 0; i < argDefaultLen; i++) {
        argDefault.push(this.readU4le());
      }
      const check = this.readU1();
      if (!( ((check == COMMON_EVENT_SECTION_A) || (check == COMMON_EVENT_SECTION_B)) )) {
        throw new Error('ValidationNotAnyOfError')
      }
      if (check === COMMON_EVENT_SECTION_B) {
        const po = this.readCpo()
      }
    }
    readArgSpecialStrData(){
      const valuesLen = this.readU4le();
      let values:lenStr[] = [];
      for (let i = 0; i < valuesLen; i++) {
        values.push(this.readLenStr());
      }
      return values
    }

    readArgSpecialNumData(){
      const valuesLen = this.readU4le();
      let values:number[] = [];
      for (let i = 0; i < valuesLen; i++) {
        values.push(this.readU4le());
      }
      return values
    }

    readCpo(){
      const color = this.readU4le();
      let varNames:lenStr[] = [];
      for (let i = 0; i < CPO_VAR_NAMES_COUNT; i++) {
        varNames.push(this.readLenStr());
      }
      const check = this.readU1();
      if (!( ((check == COMMON_EVENT_SECTION_B) || (check == COMMON_EVENT_SECTION_C)) )) {
        throw new Error(`ValidationNotAnyOfError ${check} [${COMMON_EVENT_SECTION_B}|${COMMON_EVENT_SECTION_C}]`)
      }
      if (check == COMMON_EVENT_SECTION_C) {
        const wm = this.readWm()
      }
    }

    readWm(){
      const a = this.readLenStr()
      const check = this.readU1();
      if (!( ((check == COMMON_EVENT_SECTION_C) || (check == COMMON_EVENT_SECTION_D)) )) {
        throw new Error(`ValidationNotAnyOfError ${check} [${COMMON_EVENT_SECTION_C}|${COMMON_EVENT_SECTION_D}]`)
      }
      if (check == COMMON_EVENT_SECTION_D) {
        const returner = this.readWmReturn()
      }
    }

    readWmReturn(){
      const name =this.readLenStr()
      const valueId = this.readU4le();
      const check = this.readU1();
      if (!(check == COMMON_EVENT_SECTION_D)) {
        throw new Error(`ValidationNotEqualError ${check} [${COMMON_EVENT_SECTION_D}]`)
      }
    }
}

interface WolfRoute{
    type: number,
    u1Arg: number[],
    u4Arg: number[]
}

export interface WolfCmd{
    numArg:number[],
    strArg:lenStr[]
}

interface WolfPage{
    cmd: WolfCmd[]
}

export interface WolfMapEvent{
    eventId: number,
    name: lenStr,
    x: number,
    y: number,
    pages: WolfPage[]
}