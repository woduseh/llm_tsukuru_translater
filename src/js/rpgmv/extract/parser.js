"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extract = exports.resetHadComment = exports.hadComment = exports.getVal = exports.setObj = void 0;
let _ctx;
let eventID = 0;
let hadComment = false;
exports.hadComment = hadComment;
function addtodic(pa, obj, usePath = '', conf = undefined, spliter = false) {
    const Path = pa;
    if (pa === '%comment%') {
        const id = `comment_${(Object.keys(obj.main)).length}`;
        obj.main[id] = { var: conf.comment, conf: { isComment: true }, qpath: usePath };
        return obj;
    }
    let val = returnVal(Path, obj.edited);
    if (!strNullSafe(usePath)) {
        usePath = '';
    }
    if (usePath == '') {
        if (conf !== undefined && conf.type == 'event') {
            if ([356, 357].includes(conf.code)) {
                usePath = 'script';
            }
            if ([355, 655].includes(conf.code)) {
                usePath = 'javascript';
            }
            if ([108, 408].includes(conf.code)) {
                usePath = 'note2';
            }
        }
    }
    if (val !== undefined && val !== null && typeof (val) === 'string' && (val.length > 0 || _ctx.settings.ExtractAddLine)) {
        const id = Path;
        if (usePath === 'note' || spliter) {
            obj = addtodic('%comment%', obj, usePath, { comment: '-----' });
        }
        obj.main[id] = { var: val, conf: conf, qpath: usePath };
        exports.hadComment = hadComment = false;
    }
    return obj;
}
function addtodicSpliter(pa, obj, usePath = '', conf = undefined) {
    return addtodic(pa, obj, usePath, conf, true);
}
function addComment(obj, comment, usePath = '', force = 'nonforce') {
    if (force === 'force') {
        exports.hadComment = hadComment = false;
    }
    if (!hadComment) {
        exports.hadComment = hadComment = true;
        return addtodic('%comment%', obj, usePath, { comment: comment });
    }
    return obj;
}
const addto = (key, val, temppp) => {
    if (temppp === undefined)
        temppp = {};
    const keys = key.split('.');
    let current = temppp;
    for (let i = 0; i < keys.length - 1; i++) {
        if (current[keys[i]] === undefined)
            current[keys[i]] = {};
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = val;
    return temppp;
};
const returnVal = (key, temppp) => {
    if (temppp === undefined)
        return '';
    const keys = key.split('.');
    let current = temppp;
    for (let i = 0; i < keys.length - 1; i++) {
        if (current[keys[i]] === undefined)
            current[keys[i]] = {};
        current = current[keys[i]];
    }
    return current[keys[keys.length - 1]];
};
exports.setObj = addto;
exports.getVal = returnVal;
function obNullSafe(c) {
    return (typeof c === 'object' && c !== null);
}
function strNullSafe(d) {
    return (typeof d === 'string');
}
function Extreturnit(dat_obj, Path = '', nas = null) {
    if (typeof (nas) === 'object' && nas !== null) {
        const keys = Object.keys(nas);
        for (let i = 0; i < keys.length; i++) {
            if (Path === '') {
                dat_obj = Extreturnit(dat_obj, keys[i], nas[keys[i]]);
            }
            else {
                dat_obj = Extreturnit(dat_obj, Path + '.' + keys[i], nas[keys[i]]);
            }
        }
        return dat_obj;
    }
    else {
        return addtodic(Path, dat_obj, 'ext');
    }
}
function isIncludeAble(sc) {
    const ess = _ctx.settings.extractSomeScript2;
    let able = false;
    if (sc === null || sc === undefined) {
        return false;
    }
    for (let i = 0; i < ess.length; i++) {
        if (ess[i] === '') {
            continue;
        }
        else if (sc.includes(ess[i])) {
            able = true;
            break;
        }
    }
    return able;
}
function forEvent(d, dat_obj, conf, Path) {
    const extended = conf.extended;
    const fileName = conf.fileName;
    const dir = conf.dir;
    if (obNullSafe(d)) {
        if (conf.note) {
            if (_ctx.settings.extractSomeScript) {
                if (isIncludeAble(d.note)) {
                    dat_obj = addtodic(Path + '.note', dat_obj, 'note');
                }
            }
            else {
                dat_obj = addtodic(Path + '.note', dat_obj, 'note');
            }
        }
        if (typeof d.list === 'object' && d.list !== undefined && d.list !== null) {
            let messageHasFace = false;
            const list = d.list;
            // Build acceptable codes Set once before the loop
            const acceptableSet = new Set([401, 102, 405, 101, 105]);
            if (conf.srce) {
                acceptableSet.add(356);
                acceptableSet.add(357);
            }
            if (conf.arg.ext_javascript) {
                acceptableSet.add(355);
                acceptableSet.add(655);
            }
            if (conf.note) {
                acceptableSet.add(408);
                acceptableSet.add(108);
            }
            for (const code of _ctx.settings.extractPlus)
                acceptableSet.add(code);
            const scriptCheckCodes = new Set([356, 355, 108, 408, 357]);
            const commentCodes = new Set([101, 102, 105]);
            for (let i = 0; i < list.length; i++) {
                const ischeckable = scriptCheckCodes.has(list[i].code) && _ctx.settings.extractSomeScript;
                eventID += 1;
                function checker(dat_obj, da, ca) {
                    if (typeof da === 'object') {
                        for (let i3 in da) {
                            dat_obj = checker(dat_obj, da[i3], ca + `.${i3}`);
                        }
                    }
                    else if (!ischeckable || isIncludeAble(da)) {
                        dat_obj = addtodic(ca, dat_obj, '', { type: "event", code: list[i].code, eid: eventID, face: messageHasFace });
                    }
                    return dat_obj;
                }
                if (acceptableSet.has(list[i].code) && list[i].parameters !== undefined && list[i].parameters !== null) {
                    if (commentCodes.has(list[i].code)) {
                        dat_obj = addComment(dat_obj, `--- ${list[i].code} ---`);
                    }
                    if (list[i].code === 101) {
                        if (list[i].parameters.length >= 5) {
                            dat_obj = checker(dat_obj, list[i].parameters[4], Path + `.list.${i}.parameters.${4}`);
                        }
                    }
                    else if (![105].includes(list[i].code)) {
                        for (let i2 = 0; i2 < list[i].parameters.length; i2++) {
                            dat_obj = checker(dat_obj, list[i].parameters[i2], Path + `.list.${i}.parameters.${i2}`);
                        }
                    }
                }
                else {
                    try {
                        switch (list[i].code) {
                            case 101:
                                messageHasFace = (list[i].parameters[0] !== '');
                                break;
                        }
                    }
                    catch (error) { /* non-critical: event metadata parse can fail silently */ }
                }
            }
        }
    }
    return dat_obj;
}
const resetHadComment = () => { exports.hadComment = hadComment = false; };
exports.resetHadComment = resetHadComment;
const extract = async (filedata, conf, ftype, ctx) => {
    _ctx = ctx;
    const extended = conf.extended;
    const fileName = conf.fileName;
    const dir = conf.dir;
    const dirf = dir + fileName + '\\';
    ctx.gb[fileName] = { data: {} };
    if (filedata.charCodeAt(0) === 0xFEFF) {
        filedata = filedata.substring(1);
        ctx.gb[fileName].isbom = true;
    }
    else {
        ctx.gb[fileName].isbom = false;
    }
    let data;
    try {
        data = JSON.parse(filedata);
    }
    catch (_a) {
        return {
            datobj: {},
            edited: {},
            conf: conf
        };
    }
    let dat_obj = {
        main: {},
        edited: data
    };
    if (ftype == 'map') {
        if (_ctx.settings.oneMapFile) {
            dat_obj = addComment(dat_obj, '------- MAP -------');
        }
        if (strNullSafe(data.displayName)) {
            dat_obj = addtodic(`displayName`, dat_obj);
        }
        if (conf.note) {
            if (_ctx.settings.extractSomeScript) {
                if (isIncludeAble(data.note)) {
                    dat_obj = addtodic('note', dat_obj, 'note');
                }
            }
            else {
                dat_obj = addtodic('note', dat_obj, 'note');
            }
        }
        if (obNullSafe(data.events)) {
            for (let i = 0; i < (data.events.length); i++) {
                if (obNullSafe(data.events[i]) && obNullSafe(data.events[i].pages)) {
                    if (conf.note) {
                        if (_ctx.settings.extractSomeScript) {
                            if (isIncludeAble(data.events[i].note)) {
                                dat_obj = addtodic(`events.${i}.note`, dat_obj, 'note');
                            }
                        }
                        else {
                            dat_obj = addtodic(`events.${i}.note`, dat_obj, 'note');
                        }
                    }
                    for (let a = 0; a < (data.events[i].pages.length); a++) {
                        if (obNullSafe(data.events[i].pages[a]) && obNullSafe(data.events[i].pages[a].list)) {
                            dat_obj = forEvent(data.events[i].pages[a], dat_obj, conf, `events.${i}.pages.${a}`);
                        }
                    }
                }
            }
        }
    }
    else if (ftype == 'sys') {
        if (obNullSafe(data.armorTypes)) {
            for (let i = 0; i < (data.armorTypes.length); i++) {
                dat_obj = addtodicSpliter(`armorTypes.${i}`, dat_obj);
            }
        }
        addtodic(`currencyUnit`, dat_obj);
        if (obNullSafe(data.elements)) {
            for (let i = 0; i < (data.elements.length); i++) {
                dat_obj = addtodicSpliter(`elements.${i}`, dat_obj);
            }
        }
        if (obNullSafe(data.equipTypes)) {
            for (let i = 0; i < (data.equipTypes.length); i++) {
                dat_obj = addtodicSpliter(`equipTypes.${i}`, dat_obj);
            }
        }
        addtodic(`gameTitle`, dat_obj);
        if (obNullSafe(data.skillTypes)) {
            for (let i = 0; i < (data.skillTypes.length); i++) {
                dat_obj = addtodicSpliter(`skillTypes.${i}`, dat_obj);
            }
        }
        if (obNullSafe(data.terms)) {
            if (obNullSafe(data.terms.basic)) {
                for (let i = 0; i < (data.terms.basic.length); i++) {
                    dat_obj = addtodicSpliter(`terms.basic.${i}`, dat_obj);
                }
            }
            if (obNullSafe(data.terms.commands)) {
                for (let i = 0; i < (data.terms.commands.length); i++) {
                    dat_obj = addtodicSpliter(`terms.commands.${i}`, dat_obj);
                }
            }
            if (obNullSafe(data.terms.params)) {
                for (let i = 0; i < (data.terms.params.length); i++) {
                    dat_obj = addtodicSpliter(`terms.params.${i}`, dat_obj);
                }
            }
            if (obNullSafe(data.terms.messages)) {
                for (const i of Object.keys(data.terms.messages)) {
                    dat_obj = addtodicSpliter(`terms.messages.${i}`, dat_obj);
                }
            }
        }
        if (obNullSafe(data.weaponTypes)) {
            for (let i = 0; i < (data.weaponTypes.length); i++) {
                dat_obj = addtodicSpliter(`weaponTypes.${i}`, dat_obj);
            }
        }
    }
    else if (ftype == 'ex') {
        dat_obj = Extreturnit(dat_obj, '', dat_obj.edited);
    }
    else if (ftype == 'ene2') {
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            if (!(obNullSafe(d) && obNullSafe(d.pages))) {
                continue;
            }
            const pages = d.pages;
            for (let i2 = 0; i2 < pages.length; i2++) {
                if (!(obNullSafe(pages[i2]) && obNullSafe(pages[i2].list))) {
                    continue;
                }
                dat_obj = forEvent(pages[i2], dat_obj, conf, `${i}.pages.${i2}`);
            }
        }
    }
    else {
        for (let i = 0; i < (data.length); i++) {
            const d = data[i];
            const Path = `${i}`;
            if (ftype == 'events') {
                dat_obj = forEvent(d, dat_obj, conf, Path);
            }
            else if (obNullSafe(d)) {
                if (ftype == 'actor') {
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.nickname', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.profile', dat_obj);
                }
                else if (ftype == 'class') {
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.learnings.name', dat_obj);
                }
                else if (ftype == 'skill') {
                    dat_obj = addtodicSpliter(Path + '.description', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.message1', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.message2', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj);
                }
                else if (ftype == 'state') {
                    dat_obj = addtodicSpliter(Path + '.description', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.message1', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.message2', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.message3', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.message4', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj);
                }
                else if (ftype == 'ene') {
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj);
                }
                else if (ftype == 'item') {
                    dat_obj = addtodicSpliter(Path + '.name', dat_obj);
                    dat_obj = addtodicSpliter(Path + '.description', dat_obj);
                }
                if (ftype == 'plugin') {
                    const v = Object.keys(d.parameters);
                    let shownName = false;
                    const without = ['false', 'true', 'on', 'off', 'auto'];
                    for (let i2 = 0; i2 < v.length; i2++) {
                        const targ = d.parameters[v[i2]];
                        if (isNaN(targ) && (!without.includes(targ))) {
                            if (!shownName) {
                                dat_obj = addComment(dat_obj, `//== ${d.name} ==//`, '', 'force');
                                shownName = true;
                            }
                            dat_obj = addComment(dat_obj, `--- ${v[i2]}`, '', 'force');
                            dat_obj = addtodic(Path + '.parameters.' + v[i2], dat_obj, d.name);
                            dat_obj = addComment(dat_obj, ``);
                        }
                    }
                }
                else {
                    if (conf.note) {
                        if (_ctx.settings.extractSomeScript) {
                            if (isIncludeAble(d.note)) {
                                dat_obj = addtodic(Path + '.note', dat_obj, 'note');
                            }
                        }
                        else {
                            dat_obj = addtodic(Path + '.note', dat_obj, 'note');
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
    };
};
exports.extract = extract;
