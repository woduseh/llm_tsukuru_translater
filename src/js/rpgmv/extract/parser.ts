import type { ExtractConf, ExtractFileType, ExtractEntryConf, ExtractDictEntry } from '../types';
import { AppContext } from '../../../appContext';

let _ctx: AppContext;
let eventID = 0

let hadComment = false

interface DatObj {
    main: Record<string, ExtractDictEntry>;
    edited: Record<string, any>;  // JSON data with deeply nested access
}

function addtodic(pa: string, obj: DatObj, usePath='', conf: ExtractEntryConf | undefined = undefined, spliter=false){
    const Path = pa
    if(pa === '%comment%'){
        const id = `comment_${(Object.keys(obj.main)).length}`
        obj.main[id] = {var: conf!.comment!, conf: {isComment:true}, qpath:usePath}
        return obj
    }
    let val = returnVal(Path, obj.edited)
    if(!strNullSafe(usePath)){
        usePath = ''
    }
    if(usePath == ''){
        if(conf !== undefined && conf.type == 'event'){
            if([356,357].includes(conf.code!)){
                usePath = 'script'
            }
            if([355,655].includes(conf.code!)){
                usePath = 'javascript'
            }
            if([108,408].includes(conf.code!)){
                usePath = 'note2'
            }
        }
    }
    if(val !== undefined && val !== null && typeof(val) === 'string' && (val.length > 0 || _ctx.settings.ExtractAddLine)){
        const id = Path
        if(usePath === 'note' || spliter){
            obj = addtodic('%comment%', obj, usePath, {comment:'-----'}) 
        }
        obj.main[id] = {var: val, conf: conf, qpath:usePath}
        hadComment = false
    }
    return obj
}

function addtodicSpliter(pa: string, obj: DatObj, usePath='', conf: ExtractEntryConf | undefined = undefined){
    return addtodic(pa, obj, usePath, conf, true)
}

function addComment(obj: DatObj, comment:string, usePath='', force:'force'|'nonforce'= 'nonforce'){
    if(force === 'force'){
        hadComment = false
    }
    if(!hadComment){
        hadComment = true
        return addtodic('%comment%', obj, usePath, {comment:comment}) 
    }
    return obj
}

const addto = (key: string, val: unknown, temppp: Record<string, unknown>): Record<string, unknown> => { 
    let Keys = key.split('.');
    const fkey = Keys[0]
    if(temppp === undefined){
        temppp = {}
    }
    if(Keys.length==1){
        temppp[fkey] = val;
    }
    else{
        Keys.shift()
        if(temppp[fkey] === undefined){
            temppp[fkey] = {}
        }
        temppp[fkey] = addto(Keys.join('.'), val, temppp[fkey] as Record<string, unknown>)
    }
    return temppp
}

const returnVal = (key: string, temppp: Record<string, unknown> | undefined): unknown => { 
    let Keys = key.split('.');
    const fkey = Keys[0]
    if(temppp === undefined){
        return ''
    }
    if(Keys.length==1){
        return temppp[fkey];
    }
    else{
        Keys.shift()
        if(temppp[fkey] === undefined){
            temppp[fkey] = {}
        }
        return returnVal(Keys.join('.'), temppp[fkey] as Record<string, unknown>)
    }
}

export const setObj = addto
export const getVal = returnVal

function obNullSafe(c: unknown){
    return (typeof c === 'object' && c !== null)
}

function strNullSafe(d: unknown){
    return (typeof d === 'string')
}

function Extreturnit(dat_obj: DatObj, Path='', nas: unknown=null){
    if(typeof(nas) === 'object' && nas !== null){
        const keys = Object.keys(nas as Record<string, unknown>)
        for(let i=0;i<keys.length;i++){
            if(Path === ''){
                dat_obj = Extreturnit(dat_obj, keys[i], (nas as Record<string, unknown>)[keys[i]])
            }
            else{
                dat_obj = Extreturnit(dat_obj, Path + '.' + keys[i], (nas as Record<string, unknown>)[keys[i]])
            }
        }
        return dat_obj
    }
    else{
        return addtodic(Path, dat_obj, 'ext')
    }
}

function isIncludeAble(sc: unknown){
    const ess = _ctx.settings.extractSomeScript2
    let able = false
    if(sc === null || sc === undefined){
        return false
    }
    for(let i=0;i<ess.length;i++){
        if(ess[i] === ''){
            continue
        }
        else if((sc as string).includes(ess[i])){
            able = true
            break
        }
    }
    return able
}

function forEvent(d: Record<string, unknown>, dat_obj: DatObj, conf: ExtractConf, Path: string){
    const extended = conf.extended
    const fileName = conf.fileName
    const dir = conf.dir
    if(obNullSafe(d)){
        if(conf.note){
            if(_ctx.settings.extractSomeScript){
                if(isIncludeAble(d.note)){
                    dat_obj = addtodic(Path + '.note', dat_obj, 'note')
                }
            }
            else{
                dat_obj = addtodic(Path + '.note', dat_obj, 'note')
            }
        }
        if(typeof d.list === 'object' && d.list !== undefined && d.list !== null){
            let messageHasFace = false
            const list = d.list as Record<string, unknown>[]
            for(let i=0;i<list.length;i++){
                let acceptable = [401, 102, 405, 101, 105]
                let ischeckable = false
                let reportDebug = false
                if(conf.srce){
                    acceptable = acceptable.concat([356,357])
                }
                if(conf.arg.ext_javascript){
                    acceptable = acceptable.concat([355,655])
                }
                if(conf.note){
                    acceptable = acceptable.concat([408, 108])
                }
                if([356,355,108,408,357].includes(list[i].code as number) && _ctx.settings.extractSomeScript){
                    ischeckable = true
                }
                acceptable = acceptable.concat(_ctx.settings.extractPlus)
                eventID += 1
                function checker(dat_obj: DatObj, da: unknown, ca: string){
                    if(typeof da === 'object'){
                        for(let i3 in (da as Record<string, unknown>)){
                            dat_obj = checker(dat_obj, (da as Record<string, unknown>)[i3], ca + `.${i3}`)
                        }
                    }
                    else if(!ischeckable || isIncludeAble(da)){
                        dat_obj = addtodic(ca, dat_obj, '', {type: "event",code:list[i].code as number,eid:eventID,face:messageHasFace})
                    }
                    return dat_obj
                }
                
                if (acceptable.includes(list[i].code as number) && list[i].parameters !== undefined && list[i].parameters !== null){
                    if([101,102,105].includes(list[i].code as number)){
                        dat_obj = addComment(dat_obj, `--- ${list[i].code} ---`)
                    }
                    if(list[i].code === 101){
                        if((list[i].parameters as unknown[]).length >= 5){
                            dat_obj = checker(dat_obj, (list[i].parameters as unknown[])[4], Path + `.list.${i}.parameters.${4}`)
                        }
                    }
                    else if(![105].includes(list[i].code as number)){
                        for(let i2=0;i2<(list[i].parameters as unknown[]).length;i2++){
                            dat_obj = checker(dat_obj, (list[i].parameters as unknown[])[i2], Path + `.list.${i}.parameters.${i2}`)
                        }
                    }
                }
                else{
                    try {
                        switch(list[i].code){
                            case 101:
                                messageHasFace = ((list[i].parameters as unknown[])[0] !== '')
                                break
                        }   
                    } catch (error) { /* non-critical: event metadata parse can fail silently */ }
                }
            }
        }
    }
    return dat_obj
}

export { hadComment }

export const resetHadComment = () => { hadComment = false }

export const extract = async (filedata: string, conf: ExtractConf, ftype: ExtractFileType, ctx: AppContext) => {
    _ctx = ctx;
    const extended = conf.extended
    const fileName = conf.fileName
    const dir = conf.dir
    const dirf = dir + fileName + '\\'
    ctx.gb[fileName] = {data: {}}
    if (filedata.charCodeAt(0) === 0xFEFF) {
        filedata = filedata.substring(1);
        ctx.gb[fileName].isbom = true
    }
    else{
        ctx.gb[fileName].isbom = false 
    }
    let data
    try{
        data = JSON.parse(filedata)
    }
    catch{
        return {
            datobj: {},
            edited: {},
            conf: conf
        }
    }
    let dat_obj: DatObj = {
        main: {},
        edited: data
    }
    if(ftype == 'map'){
        if(_ctx.settings.oneMapFile){
            dat_obj = addComment(dat_obj, '------- MAP -------')
        }

        if(strNullSafe(data.displayName)){
            dat_obj = addtodic(`displayName`, dat_obj)
        }
        if(conf.note){
            if(_ctx.settings.extractSomeScript){
                if(isIncludeAble(data.note)){
                    dat_obj = addtodic('note', dat_obj, 'note')
                }
            }
            else{
                dat_obj = addtodic('note', dat_obj, 'note')
            }
        }
        if(obNullSafe(data.events)){
            for(let i =0;i<(data.events.length);i++){
                if(obNullSafe(data.events[i]) && obNullSafe(data.events[i].pages)){
                    if(conf.note){
                        if(_ctx.settings.extractSomeScript){
                            if(isIncludeAble(data.events[i].note)){
                                dat_obj = addtodic(`events.${i}.note`, dat_obj, 'note')
                            }
                        }
                        else{
                            dat_obj = addtodic(`events.${i}.note`, dat_obj, 'note')
                        }
                    }
                    for(let a =0;a<(data.events[i].pages.length);a++){
                        if(obNullSafe(data.events[i].pages[a]) && obNullSafe(data.events[i].pages[a].list)){
                            dat_obj = forEvent(data.events[i].pages[a], dat_obj, conf, `events.${i}.pages.${a}`)
                        }
                    }
                }
            }
        }
    }
    else if(ftype == 'sys'){
        if(obNullSafe(data.armorTypes)){
            for(let i =0; i<(data.armorTypes.length);i++){
                dat_obj = addtodicSpliter(`armorTypes.${i}`, dat_obj)
            }
        }
        addtodic(`currencyUnit`, dat_obj)
        if(obNullSafe(data.elements)){
            for(let i=0;i<(data.elements.length);i++){
                dat_obj = addtodicSpliter(`elements.${i}`, dat_obj)
            }
        }
        if(obNullSafe(data.equipTypes)){
            for(let i=0;i<(data.equipTypes.length);i++){
                dat_obj = addtodicSpliter(`equipTypes.${i}`, dat_obj)
            }
        }
        addtodic(`gameTitle`, dat_obj)
        if(obNullSafe(data.skillTypes)){
            for(let i=0;i<(data.skillTypes.length);i++){
                dat_obj = addtodicSpliter(`skillTypes.${i}`, dat_obj)
            }
        }
        if(obNullSafe(data.terms)){
            if(obNullSafe(data.terms.basic)){
                for(let i=0;i<(data.terms.basic.length);i++){
                    dat_obj = addtodicSpliter(`terms.basic.${i}`, dat_obj)
                }
            }
            if(obNullSafe(data.terms.commands)){
                for(let i=0;i<(data.terms.commands.length);i++){
                    dat_obj = addtodicSpliter(`terms.commands.${i}`, dat_obj)
                }
            }
            if(obNullSafe(data.terms.params)){
                for(let i=0;i<(data.terms.params.length);i++){
                    dat_obj = addtodicSpliter(`terms.params.${i}`, dat_obj)
                }
            }
            if(obNullSafe(data.terms.messages)){
                for(const i of Object.keys(data.terms.messages)){
                    dat_obj = addtodicSpliter(`terms.messages.${i}`, dat_obj)
                }
            }
        }
        if(obNullSafe(data.weaponTypes)){
            for(let i=0;i<(data.weaponTypes.length);i++){
                dat_obj = addtodicSpliter(`weaponTypes.${i}`, dat_obj)
            }
        }
    }
    else if(ftype == 'ex'){
        dat_obj = Extreturnit(dat_obj, '', dat_obj.edited)
    }
    else if(ftype == 'ene2'){
        for(let i=0;i<data.length;i++){
            const d = data[i] as Record<string, any>
            if(!(obNullSafe(d) && obNullSafe(d.pages))){
                continue
            }
            const pages = d.pages as any[]
            for(let i2=0;i2<pages.length;i2++){
                if(!(obNullSafe(pages[i2]) && obNullSafe(pages[i2].list))){
                    continue
                }
                dat_obj = forEvent(pages[i2], dat_obj, conf, `${i}.pages.${i2}`)
            }
        }
    }
    else{
        for(let i=0;i<(data.length);i++){
            const d = data[i] as Record<string, any>
            const Path = `${i}`
            if(ftype == 'events'){
                dat_obj = forEvent(d, dat_obj, conf, Path)
            }
            else if(obNullSafe(d)){
                if(ftype == 'actor'){
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.nickname', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.profile', dat_obj)
                }
                else if(ftype == 'class'){
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.learnings.name', dat_obj)
                }
                else if(ftype == 'skill'){
                    dat_obj = addtodicSpliter(Path + '.description', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.message1', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.message2', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj)
                }
                else if(ftype == 'state'){
                    dat_obj = addtodicSpliter(Path + '.description', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.message1', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.message2', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.message3', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.message4', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj)
                }
                else if(ftype == 'ene'){
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj)
                }
                else if(ftype == 'item'){
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj)
                    dat_obj = addtodicSpliter(Path + '.description', dat_obj)
                }
                if(ftype == 'plugin'){
                    const v = Object.keys(d.parameters)
                    let shownName = false
                    const without = ['false', 'true','on','off','auto']
                    for(let i2=0;i2<v.length;i2++){
                        const targ = d.parameters[v[i2]]
                        if(isNaN(targ) && (!without.includes(targ))){
                            if(!shownName){
                                dat_obj = addComment(dat_obj, `//== ${d.name} ==//`, '', 'force')
                                shownName = true
                            }
                            dat_obj = addComment(dat_obj, `--- ${v[i2]}`, '', 'force')
                            dat_obj = addtodic(Path + '.parameters.' + v[i2], dat_obj, d.name)
                            dat_obj = addComment(dat_obj, ``)
                        }
                    }
                }
                else{
                    if(conf.note){
                        if(_ctx.settings.extractSomeScript){
                            if(isIncludeAble(d.note)){
                                dat_obj = addtodic(Path + '.note', dat_obj, 'note')
                            }
                        }
                        else{
                            dat_obj = addtodic(Path + '.note', dat_obj, 'note')
                        }
                    }
                }
            }
        }
    }
    return {
        datobj: dat_obj.main,
        edited: dat_obj.edited,
        conf: conf
    }
}
