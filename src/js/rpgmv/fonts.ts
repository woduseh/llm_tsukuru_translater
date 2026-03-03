import { ipcMain, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { JSDOM } from "jsdom";
import Tools from '../libs/projectTools';

export function initFontIPC(){
  ipcMain.on('selFont', async (ev, dir) => {
    if(!fs.existsSync(dir)){
      Tools.sendError('지정된 디렉토리가 없습니다')
      Tools.worked()
      return
    }
    if(path.parse(dir).name !== 'data'){
      Tools.sendError('data 폴더가 아닙니다')
      Tools.worked()
      return
    }
    const f = await dialog.showOpenDialog({
      "title": '폰트 선택',
      "properties": ["openFile"],
      "filters":[{
        "name": "폰트",
        "extensions": ["ttf", "otf"]
      }],
    })
    if(f.canceled){
      Tools.sendError('취소되었습니다')
      Tools.worked()
      return
    }
    const fPath = f.filePaths[0]
    const MfontPath = path.join(path.dirname(dir), 'fonts', 'mplus-1m-regular.ttf')
    if(fPath === MfontPath){
      Tools.sendError('이미 사용 중인 폰트입니다')
      Tools.worked()
      return
    }
    fs.copyFileSync(fPath, MfontPath)
    Tools.sendAlert('완료되었습니다')
    Tools.worked()
})

ipcMain.on('changeFontSize', async (ev, arg) => {
  const dir = arg[0]
  const num = arg[1]
    if(!fs.existsSync(dir)){
        Tools.sendError('지정된 디렉토리가 없습니다')
        Tools.worked()
        return
    }
    if(path.parse(dir).name !== 'data' && (!arg.force)){
        Tools.sendError('data 폴더가 아닙니다')
        Tools.worked()
        return
    }
    const windowJSpath = path.join(path.dirname(dir), 'js', 'rpg_windows.js')
    let f = fs.readFileSync(windowJSpath, 'utf-8')
    const a = `Window_Base.prototype.standardFontSize = function() {return ${num}}`
    if ((/Window_Base.prototype.standardFontSize = function\(\) {return [0-9]+}/).test(f)){
      f = f.replace(/Window_Base.prototype.standardFontSize = function\(\) {return [0-9]+}/, a)
    }
    else{
      f += '\n' + a
    }
    fs.writeFileSync(windowJSpath, f ,'utf-8')
    Tools.sendAlert('완료되었습니다')
    Tools.worked()
    
});
}