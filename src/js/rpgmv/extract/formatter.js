"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.format_extracted = void 0;
exports.jpathIsMap = jpathIsMap;
const path_1 = __importDefault(require("path"));
const datas_1 = require("../datas");
function obNullSafe(c) {
    return (typeof c === 'object' && c !== null);
}
function jpathIsMap(jpath) {
    const name = path_1.default.parse(jpath).name;
    return (name.length === 6 && name.substring(0, 3) === 'Map' && !isNaN(Number(name.substring(3))));
}
/** Count newline characters in a string without allocating an array. */
function countNewlines(str) {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) === 10)
            count++;
    }
    return count;
}
const format_extracted = async (dats, typ = 0, ctx) => {
    const datobj = dats.datobj;
    const conf = dats.conf;
    const extended = conf.extended;
    const fileName = conf.fileName;
    const dir = conf.dir;
    if (typ == 0) {
        const Keys = Object.keys(datobj);
        let LenMemory = {};
        const usedEid = new Set();
        const beautifyCodesSet = new Set(datas_1.beautifyCodes);
        const beautifyCodes2Set = new Set(datas_1.beautifyCodes2);
        const externMsgKeySet = ctx.useExternMsg ? new Set(ctx.externMsgKeys) : null;
        ctx.gb[fileName].outputText = '';
        for (const d of Keys) {
            let jpath = fileName;
            if (datobj[d].qpath === 'script' && ctx.settings.onefile_src) {
                jpath = 'ext_scripts.json';
            }
            else if (datobj[d].qpath === 'note' && ctx.settings.onefile_note) {
                jpath = 'ext_note.json';
            }
            else if (datobj[d].qpath === 'note2' && ctx.settings.onefile_note) {
                jpath = 'ext_note2.json';
            }
            else if (datobj[d].qpath === 'javascript' && ctx.settings.onefile_src) {
                jpath = 'ext_javascript.json';
            }
            else if (ctx.settings.oneMapFile && jpathIsMap(jpath)) {
                jpath = 'Maps.json';
            }
            if (externMsgKeySet !== null) {
                if (externMsgKeySet.has(datobj[d].var)) {
                    datobj[d].var = ctx.externMsg[datobj[d].var];
                }
            }
            if (!(jpath in LenMemory)) {
                LenMemory[jpath] = countNewlines(ctx.gb[jpath].outputText);
            }
            if (ctx.settings.formatNice && obNullSafe(datobj[d].conf)) {
                if (beautifyCodesSet.has(datobj[d].conf.code)) {
                    ctx.gb[jpath].outputText += '==========\n';
                    LenMemory[jpath] += 1;
                }
                const eid = datobj[d].conf.eid;
                if (eid !== undefined && eid !== null) {
                    if (!usedEid.has(eid) && beautifyCodes2Set.has(datobj[d].conf.code)) {
                        ctx.gb[jpath].outputText += `//==========//\n`;
                        LenMemory[jpath] += 1;
                        usedEid.add(eid);
                    }
                }
            }
            const cid = LenMemory[jpath];
            ctx.gb[jpath].data[cid] = {};
            ctx.gb[jpath].data[cid].origin = fileName;
            ctx.gb[jpath].data[cid].type = 'None';
            ctx.gb[jpath].data[cid].val = d;
            ctx.gb[jpath].data[cid].conf = datobj[d].conf;
            ctx.gb[jpath].data[cid].originText = datobj[d].var;
            const toadd = datobj[d].var + '\n';
            ctx.gb[jpath].outputText += toadd;
            LenMemory[jpath] += countNewlines(toadd);
            ctx.gb[jpath].data[cid].m = LenMemory[jpath];
        }
    }
};
exports.format_extracted = format_extracted;
