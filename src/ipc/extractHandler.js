"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractor = extractor;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ExtTool = __importStar(require("../js/rpgmv/extract.js"));
const edTool = __importStar(require("../js/rpgmv/edtool.js"));
const dataBaseO = __importStar(require("../js/rpgmv/datas.js"));
const globalutils_js_1 = require("../js/rpgmv/globalutils.js");
const yaml = __importStar(require("js-yaml"));
const shared_1 = require("./shared");
const ErrorAlert = (msg) => (0, shared_1.sendError)(msg);
async function extractor(arg) {
    try {
        globalThis.gb = {};
        let file;
        let v;
        const extended = true;
        if (!arg.silent) {
            arg.silent = false;
        }
        const dir = Buffer.from(arg.dir, "base64").toString('utf8');
        if (!fs_1.default.existsSync(dir)) {
            (0, shared_1.getMainWindow)().webContents.send('alert', { icon: 'error', message: '지정된 디렉토리가 없습니다' });
            (0, shared_1.worked)();
            return;
        }
        if (path_1.default.parse(dir).name !== 'data' && (!arg.force)) {
            (0, shared_1.getMainWindow)().webContents.send('alert', { icon: 'error', message: 'data 폴더가 아닙니다' });
            (0, shared_1.worked)();
            return;
        }
        if (fs_1.default.existsSync(dir + '/Extract')) {
            if (!arg.force) {
                (0, shared_1.getMainWindow)().webContents.send('check_force', arg);
                (0, shared_1.worked)();
                return;
            }
            else {
                fs_1.default.rmSync(dir + '/Extract', { recursive: true });
                if (fs_1.default.existsSync(dir + '/Backup')) {
                    fs_1.default.rmSync(dir + '/Backup', { recursive: true });
                }
            }
        }
        if (arg.ext_plugin) {
            let jsdir = ((dir.substring(0, dir.length - 5) + '/js').replaceAll('//', '/'));
            if (!fs_1.default.existsSync(jsdir + '/plugins.js')) {
                jsdir = path_1.default.join(path_1.default.dirname(path_1.default.dirname(path_1.default.dirname(jsdir))), 'js');
                if (!fs_1.default.existsSync(jsdir + '/plugins.js')) {
                    (0, shared_1.getMainWindow)().webContents.send('alert', { icon: 'error', message: 'plugin.js가 존재하지 않습니다' });
                    (0, shared_1.worked)();
                    return;
                }
            }
            let hail2 = fs_1.default.readFileSync(jsdir + '/plugins.js', 'utf-8');
            let hail = hail2.split('$plugins =');
            hail2 = hail[hail.length - 1] + '  ';
            hail2 = hail2.substring(hail2.indexOf('['), hail2.lastIndexOf(']') + 1);
            fs_1.default.writeFileSync(dir + '/ext_plugins.json', JSON.stringify(JSON.parse(hail2)), 'utf-8');
        }
        globalThis.externMsg = {};
        globalThis.useExternMsg = false;
        if (fs_1.default.existsSync(dir + '/ExternMessage.csv') && arg.exJson && globalThis.settings.ExternMsgJson) {
            const Emsg = await ExtTool.parse_externMsg(dir + '/ExternMessage.csv', !globalThis.settings.ExternMsgJson);
            globalThis.externMsg = Emsg;
            if (globalThis.settings.ExternMsgJson) {
                fs_1.default.writeFileSync(dir + '/ExternMsgcsv.json', JSON.stringify(Emsg, null, 4), 'utf-8');
            }
            else {
                globalThis.useExternMsg = true;
                globalThis.externMsgKeys = Object.keys(Emsg);
            }
        }
        let tempjsons = [];
        const fileList2 = fs_1.default.readdirSync(dir);
        for (const i in fileList2) {
            const f = path_1.default.join(dir, fileList2[i]);
            const pf = path_1.default.parse(f);
            if (f.endsWith('.json.yaml')) {
                const fname = path_1.default.join(pf.dir, pf.name);
                const fd = JSON.stringify(yaml.load(fs_1.default.readFileSync(f, 'utf-8')));
                fs_1.default.writeFileSync(fname, fd, 'utf-8');
                tempjsons.push(fname);
            }
        }
        const fileList = fs_1.default.readdirSync(dir);
        if (!fs_1.default.existsSync(dir + '/Extract')) {
            fs_1.default.mkdirSync(dir + '/Extract');
        }
        if (!fs_1.default.existsSync(dir + '/Backup')) {
            fs_1.default.mkdirSync(dir + '/Backup');
        }
        const onebyone = dataBaseO.onebyone;
        const max_files = fileList.length;
        let worked_files = 0;
        ExtTool.init_extract(arg);
        for (const i in fileList) {
            worked_files += 1;
            const fileName = fileList[i];
            if (path_1.default.parse(fileName).ext != '.json') {
                continue;
            }
            const conf = {
                extended: extended,
                fileName: fileName,
                dir: dir,
                srce: arg.ext_src,
                autoline: arg.autoline,
                note: arg.ext_note,
                arg: arg
            };
            let runBackup = async () => {
                try {
                    fs_1.default.copyFileSync(dir + '/' + fileName, dir + '/Backup/' + fileName);
                }
                catch (error) { console.error('Backup failed for', fileName, error); }
            };
            runBackup();
            if ((0, globalutils_js_1.checkIsMapFile)(fileName)) {
                file = fs_1.default.readFileSync(dir + '/' + fileName, 'utf8');
                await ExtTool.format_extracted(await ExtTool.extract(file, conf, 'map'));
            }
            else if (Object.keys(onebyone).includes(fileName)) {
                file = fs_1.default.readFileSync(dir + '/' + fileName, 'utf8');
                await ExtTool.format_extracted(await ExtTool.extract(file, conf, onebyone[fileName]));
            }
            else if (arg.exJson) {
                if (!dataBaseO.ignores.includes(fileName)) {
                    file = fs_1.default.readFileSync(dir + '/' + fileName, 'utf8');
                    await ExtTool.format_extracted(await ExtTool.extract(file, conf, 'ex'));
                }
            }
            (0, shared_1.getMainWindow)().webContents.send('loading', worked_files / max_files * 100);
            await (0, globalutils_js_1.sleep)(0);
        }
        const gbKeys = { ...Object.keys(globalThis.gb) };
        for (const i in gbKeys) {
            const fileName = gbKeys[i];
            if (globalThis.gb[fileName].outputText === '') {
                delete globalThis.gb[fileName];
            }
            else if (fileName === 'ext_javascript.json') {
                fs_1.default.writeFileSync(dir + `/Extract/${path_1.default.parse(fileName).name}.js`, globalThis.gb[fileName].outputText, 'utf-8');
                delete globalThis.gb[fileName].outputText;
            }
            else {
                fs_1.default.writeFileSync(dir + `/Extract/${path_1.default.parse(fileName).name}.txt`, globalThis.gb[fileName].outputText, 'utf-8');
                delete globalThis.gb[fileName].outputText;
            }
        }
        const ext_data = {
            main: globalThis.gb
        };
        edTool.write(dir, ext_data);
        if (fs_1.default.existsSync(dir + '/ext_plugins.json')) {
            fs_1.default.rmSync(dir + '/ext_plugins.json');
        }
        if (fs_1.default.existsSync(dir + '/ExternMsgcsv.json')) {
            fs_1.default.rmSync(dir + '/ExternMsgcsv.json');
        }
        for (const i in tempjsons) {
            fs_1.default.rmSync(tempjsons[i]);
        }
        (0, shared_1.getMainWindow)().webContents.send('loading', 0);
        ['img', 'audio'].forEach((type) => {
            const ExtractImgDir = path_1.default.join(dir, `Extract_${type}`);
            if (fs_1.default.existsSync(ExtractImgDir)) {
                fs_1.default.rmSync(ExtractImgDir, { recursive: true, force: true });
            }
        });
        if (arg.decryptImg) {
            await ExtTool.DecryptDir(dir, "img");
        }
        if (arg.decryptAudio) {
            await ExtTool.DecryptDir(dir, "audio");
        }
        if (!arg.silent) {
            (0, shared_1.getMainWindow)().webContents.send('alert2');
        }
    }
    catch (err) {
        (0, shared_1.getMainWindow)().webContents.send('alert', { icon: 'error', message: JSON.stringify(err, Object.getOwnPropertyNames(err)) });
    }
}
electron_1.ipcMain.on('extract', async (ev, arg) => {
    await extractor(arg);
    (0, shared_1.worked)();
});
electron_1.ipcMain.on('updateVersion', async (ev, arg) => {
    function endThis() {
        (0, shared_1.worked)();
    }
    try {
        if (!fs_1.default.existsSync(path_1.default.join(arg.dir1_base, 'Extract'))) {
            ErrorAlert('구버전 번역본의 Extract 폴더가 존재하지 않습니다');
            (0, shared_1.worked)();
            return;
        }
        await extractor({
            ...arg.dir3,
            dir: Buffer.from(path_1.default.join(arg.dir3_base), "utf8").toString('base64'),
            force: true,
            silent: true
        });
        await extractor({
            ...arg.dir2,
            dir: Buffer.from(path_1.default.join(arg.dir2_base), "utf8").toString('base64'),
            force: true,
            silent: true
        });
        const TranslatedDir = path_1.default.join(arg.dir1_base, 'Extract');
        const OldDir = path_1.default.join(arg.dir3_base, 'Extract');
        const NewDir = path_1.default.join(arg.dir2_base, 'Extract');
        const fileList1 = fs_1.default.readdirSync(OldDir);
        for (let i in (fileList1)) {
            const parsed = path_1.default.parse(fileList1[i]);
            const file = parsed.name.concat(parsed.ext);
            let TransDict = {};
            const dat1 = fs_1.default.readFileSync(path_1.default.join(OldDir, file), 'utf-8').split('\n');
            if (!((fs_1.default.existsSync(path_1.default.join(TranslatedDir, file))))) {
                ErrorAlert('구버전의 번역본 파일과 미번역본 파일이 서로 통하지 않습니다. ');
                endThis();
                return;
            }
            const dat0 = fs_1.default.readFileSync(path_1.default.join(TranslatedDir, file), 'utf-8').split('\n');
            let dat2 = fs_1.default.readFileSync(path_1.default.join(NewDir, file), 'utf-8');
            let dat2_dat = dat2.split('\n');
            function UpReplacer(data, source, to, all = false) {
                for (let i = 0; i < data.length; i++) {
                    if (data[i] === source) {
                        data[i] = to;
                        if (!all) {
                            break;
                        }
                    }
                }
                return data;
            }
            for (let i2 in (dat0)) {
                TransDict[dat1[i2]] = dat0[i2];
                dat2_dat = UpReplacer(dat2_dat, dat1[i2], dat0[i2], false);
            }
            for (let i2 in TransDict) {
                dat2_dat = UpReplacer(dat2_dat, dat1[i2], dat0[i2], true);
            }
            dat2 = dat2_dat.join('\n');
            fs_1.default.writeFileSync(path_1.default.join(NewDir, file), dat2, 'utf-8');
            (0, shared_1.getMainWindow)().webContents.send('loading', Number(i) / fileList1.length * 100);
            await (0, globalutils_js_1.sleep)(0);
        }
        (0, shared_1.getMainWindow)().webContents.send('alert', '완료되었습니다');
        endThis();
    }
    catch (err) {
        (0, shared_1.getMainWindow)().webContents.send('alert', { icon: 'error', message: JSON.stringify(err, Object.getOwnPropertyNames(err)) });
        endThis();
    }
});
