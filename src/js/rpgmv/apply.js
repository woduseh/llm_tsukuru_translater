"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = void 0;
const fs_1 = __importDefault(require("fs"));
const ExtTool = __importStar(require("./extract/index.js"));
const path_1 = __importDefault(require("path"));
const edTool = __importStar(require("./edtool.js"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const globalutils_1 = require("./globalutils");
const projectTools_1 = __importDefault(require("../libs/projectTools"));
const logger_1 = __importDefault(require("../../logger"));
const fileIO_1 = require("../libs/fileIO");
function getBinarySize(string) {
    return Buffer.byteLength(string, 'utf8');
}
const apply = async (ev, arg, ctx) => {
    var _a;
    try {
        const dir = (Buffer.from(arg.dir, "base64").toString('utf8'));
        if (!fs_1.default.existsSync(dir + '/Extract')) {
            projectTools_1.default.sendError('Extract 폴더가 존재하지 않습니다');
            projectTools_1.default.worked();
            return;
        }
        if (!edTool.exists(dir)) {
            projectTools_1.default.sendError('.extracteddata 파일이 존재하지 않습니다');
            projectTools_1.default.worked();
            return;
        }
        if (!arg.instantapply) {
            const completedDir = dir + '/Completed';
            if (fs_1.default.existsSync(completedDir)) {
                fs_1.default.rmSync(completedDir, { recursive: true });
            }
            fs_1.default.mkdirSync(completedDir + '/data', { recursive: true });
            fs_1.default.mkdirSync(completedDir + '/js', { recursive: true });
        }
        const jsdir = ((dir.substring(0, dir.length - 5) + '/js').replaceAll('//', '/'));
        let ext_data = edTool.read(dir);
        const ext_dat = ext_data.main;
        const max_files = Object.keys(ext_dat).length;
        let worked_files = 0;
        let OutputData = {};
        for (const i of Object.keys(ext_dat)) {
            if (fs_1.default.existsSync(dir + '/Backup/' + i)) {
                let filedata = (0, fileIO_1.readTextFile)(dir + '/Backup/' + i);
                try {
                    OutputData[i] = JSON.parse(filedata);
                }
                catch (error) {
                    logger_1.default.warn('Failed to parse backup file:', i, error);
                }
            }
        }
        for (const i of Object.keys(ext_dat)) {
            worked_files += 1;
            if (i.includes('.json')) {
                let fname = (i === 'ext_javascript.json') ? dir + '/Extract/ext_javascript.js' : dir + '/Extract/' + path_1.default.parse(i).name + '.txt';
                let Edata = (0, fileIO_1.readTextFile)(fname).split('\n');
                for (const q of Object.keys(ext_dat[i].data)) {
                    let output = '';
                    let autoline = false;
                    let autolineSize = 0;
                    let originFile = (_a = ext_dat[i].data[q].origin) !== null && _a !== void 0 ? _a : i;
                    if (ext_dat[i].data[q].conf !== undefined) {
                        const econf = ext_dat[i].data[q].conf;
                        if (arg.autoline && econf.type == 'event' && econf.code == 401) {
                            autoline = true;
                            autolineSize = econf.face ? 80 : 60;
                        }
                        if (arg.isComment) {
                            continue;
                        }
                    }
                    for (let x = parseInt(q); x < ext_dat[i].data[q].m; x++) {
                        let forUse = Edata[x];
                        if (autoline && (getBinarySize(forUse) > autolineSize)) {
                            let v = forUse.split(' ');
                            if (v.length > 1) {
                                v[(Math.floor(v.length / 2)) - 1] = '\n' + v[(Math.floor(v.length / 2)) - 1];
                            }
                            forUse = v.join(' ');
                        }
                        output += forUse;
                        if (x !== (ext_dat[i].data[q].m - 1)) {
                            output += '\n';
                        }
                    }
                    try {
                        if (!(originFile in OutputData)) {
                            const fidir = path_1.default.join(dir, 'Backup', originFile);
                            if (fs_1.default.existsSync(fidir)) {
                                let filedata = (0, fileIO_1.readTextFile)(fidir);
                                try {
                                    OutputData[originFile] = JSON.parse(filedata);
                                }
                                catch (error) {
                                    logger_1.default.warn('Failed to parse backup JSON:', originFile, error);
                                }
                            }
                        }
                        OutputData[originFile] = ExtTool.setObj(ext_dat[i].data[q].val, output, OutputData[originFile]);
                    }
                    catch (error) {
                        logger_1.default.warn('Failed to set value for:', ext_dat[i].data[q].val, error);
                    }
                }
            }
            projectTools_1.default.send('loading', worked_files / max_files * 100);
            await (0, globalutils_1.sleep)(0);
        }
        for (const i of Object.keys(OutputData)) {
            const data = OutputData[i];
            if (i == 'ext_plugins.json') {
                const vaq = `var $plugins = ${JSON.stringify(data)};`;
                if (arg.instantapply) {
                    (0, fileIO_1.writeTextFile)(jsdir + '/plugins.js', vaq);
                }
                else {
                    (0, fileIO_1.writeTextFile)(dir + '/Completed/js/plugins.js', vaq);
                }
            }
            else if (i == 'ExternMsgcsv.json') {
                if (arg.instantapply) {
                    await ExtTool.pack_externMsg(dir + '/ExternMessage.csv', data);
                }
                else {
                    await ExtTool.pack_externMsg(dir + '/Completed/data/ExternMessage.csv', data);
                }
            }
            else {
                const fdir = arg.instantapply ? path_1.default.join(dir, i) : path_1.default.join(dir, 'Completed', 'data', i);
                const fdir2 = arg.instantapply ? path_1.default.join(dir, `${i}.yaml`) : path_1.default.join(dir, 'Completed', 'data', `${i}.yaml`);
                const fd = arg.useYaml ? fdir2 : fdir;
                const dataJson = arg.useYaml ? js_yaml_1.default.dump(data) : JSON.stringify(data, null, 4 * Number(ctx.settings.JsonChangeLine));
                (0, fileIO_1.writeTextFile)(fd, dataJson);
                if (arg.useYaml && fs_1.default.existsSync(fdir)) {
                    fs_1.default.rmSync(fdir);
                }
                else if ((!arg.useYaml) && fs_1.default.existsSync(fdir2)) {
                    fs_1.default.rmSync(fdir2);
                }
            }
        }
        await ExtTool.EncryptDir(dir, 'img', !!arg.instantapply);
        await ExtTool.EncryptDir(dir, 'audio', !!arg.instantapply);
        projectTools_1.default.send('alert2');
        projectTools_1.default.send('loading', 0);
    }
    catch (err) {
        logger_1.default.error('Apply failed:', err);
        projectTools_1.default.sendError(JSON.stringify(err, Object.getOwnPropertyNames(err)));
    }
    projectTools_1.default.worked();
};
exports.apply = apply;
