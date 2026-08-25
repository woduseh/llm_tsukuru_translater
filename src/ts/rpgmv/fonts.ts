import { ipcMain, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import Tools from '../libs/projectTools';
import { readTextFile } from '../libs/fileIO';
import { atomicWriteTextFile } from '../libs/atomicFile';

export function initFontIPC(){
  ipcMain.on('selFont', async (ev, dir) => {
    try {
      const dataDir = validateDataDir(dir)
      const f = await dialog.showOpenDialog({
        "title": '폰트 선택',
        "properties": ["openFile"],
        "filters":[{
          "name": "폰트",
          "extensions": ["ttf", "otf"]
        }],
      })
      if(f.canceled || f.filePaths.length === 0) return
      const sourcePath = path.resolve(f.filePaths[0])
      installProjectFont(dataDir, sourcePath)
      Tools.sendAlert('완료되었습니다')
    } catch (error) {
      Tools.sendError((error as Error).message || String(error))
    } finally {
      Tools.worked()
    }
})

ipcMain.on('changeFontSize', async (ev, arg) => {
  try {
    const dir = validateDataDir(Array.isArray(arg) ? arg[0] : undefined)
    const num = Array.isArray(arg) ? arg[1] : undefined
    if (!Number.isInteger(num) || num < 8 || num > 100) {
      throw new Error('폰트 크기는 8~100 사이의 정수여야 합니다')
    }
    updateProjectFontSize(dir, num)
    Tools.sendAlert('완료되었습니다')
  } catch (error) {
    Tools.sendError((error as Error).message || String(error))
  } finally {
    Tools.worked()
  }
    
});
}

export function installProjectFont(dataDir: string, sourcePath: string): void {
  const resolvedDataDir = validateDataDir(dataDir)
  const resolvedSource = path.resolve(sourcePath)
  const extension = path.extname(resolvedSource).toLowerCase()
  if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) {
    throw new Error('선택한 폰트 파일이 존재하지 않습니다')
  }
  if (extension !== '.ttf' && extension !== '.otf') {
    throw new Error('TTF 또는 OTF 폰트만 사용할 수 있습니다')
  }

  const projectRoot = path.dirname(resolvedDataDir)
  const fontsDir = path.join(projectRoot, 'fonts')
  const targetName = `tsukuru-selected-font${extension}`
  const targetPath = path.join(fontsDir, targetName)
  if (path.normalize(resolvedSource).toLowerCase() === path.normalize(targetPath).toLowerCase()) {
    throw new Error('이미 사용 중인 폰트입니다')
  }

  const mzScript = path.join(projectRoot, 'js', 'rmmz_objects.js')
  const mvCss = path.join(fontsDir, 'gamefont.css')
  if (fs.existsSync(mzScript)) {
    const systemPath = path.join(resolvedDataDir, 'System.json')
    if (!fs.existsSync(systemPath)) throw new Error('MZ System.json을 찾을 수 없습니다')
    const original = readTextFile(systemPath)
    const system = JSON.parse(original) as { advanced?: Record<string, unknown> }
    if (!system.advanced || typeof system.advanced !== 'object') {
      throw new Error('MZ System.json.advanced 설정을 찾을 수 없습니다')
    }
    system.advanced.mainFontFilename = targetName
    replaceFontThenConfig(resolvedSource, targetPath, () => {
      atomicWriteTextFile(systemPath, `${JSON.stringify(system, null, 4)}\n`, { encoding: 'utf-8' })
    })
    return
  }

  if (fs.existsSync(mvCss)) {
    const original = readTextFile(mvCss)
    const gameFontBlock = /@font-face\s*\{[^}]*font-family\s*:\s*['"]?GameFont['"]?\s*;[^}]*\}/i
    const blockMatch = original.match(gameFontBlock)
    if (!blockMatch) throw new Error('MV gamefont.css에서 GameFont 설정을 찾을 수 없습니다')
    const sourceRule = /src\s*:\s*url\(\s*(['"]?)[^'")]+\1\s*\)([^;]*);/i
    if (!sourceRule.test(blockMatch[0])) {
      throw new Error('MV gamefont.css에서 GameFont src 설정을 찾을 수 없습니다')
    }
    const updatedBlock = blockMatch[0].replace(sourceRule, `src: url("${targetName}")$2;`)
    const updatedCss = original.replace(blockMatch[0], updatedBlock)
    replaceFontThenConfig(resolvedSource, targetPath, () => {
      atomicWriteTextFile(mvCss, updatedCss, { encoding: 'utf-8' })
    })
    return
  }

  throw new Error('MV/MZ 폰트 설정을 찾을 수 없습니다')
}

function replaceFontThenConfig(sourcePath: string, targetPath: string, updateConfig: () => void): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const stagingPath = `${targetPath}.staging-${suffix}`
  const previousPath = `${targetPath}.previous-${suffix}`
  const hadPrevious = fs.existsSync(targetPath)
  try {
    fs.copyFileSync(sourcePath, stagingPath)
    if (hadPrevious) fs.renameSync(targetPath, previousPath)
    fs.renameSync(stagingPath, targetPath)
    try {
      updateConfig()
    } catch (error) {
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath)
      if (hadPrevious && fs.existsSync(previousPath)) fs.renameSync(previousPath, targetPath)
      throw error
    }
    if (hadPrevious && fs.existsSync(previousPath)) fs.rmSync(previousPath)
  } catch (error) {
    if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath)
    if (!fs.existsSync(targetPath) && hadPrevious && fs.existsSync(previousPath)) {
      fs.renameSync(previousPath, targetPath)
    }
    throw error
  }
}

function validateDataDir(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('지정된 디렉토리가 없습니다')
  }
  const resolved = path.resolve(value)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('지정된 디렉토리가 없습니다')
  }
  if (path.basename(resolved).toLowerCase() !== 'data') {
    throw new Error('data 폴더가 아닙니다')
  }
  return resolved
}

export function updateProjectFontSize(dataDir: string, size: number): void {
  const jsDir = path.join(path.dirname(dataDir), 'js')
  const mvPath = path.join(jsDir, 'rpg_windows.js')
  const mzPath = path.join(jsDir, 'rmmz_objects.js')
  if (fs.existsSync(mvPath)) {
    const pattern = /Window_Base\.prototype\.standardFontSize = function\(\)\s*\{\s*return\s+[0-9]+;?\s*\};?/
    const replacement = `Window_Base.prototype.standardFontSize = function() {return ${size}}`
    const source = readTextFile(mvPath)
    atomicWriteTextFile(mvPath, pattern.test(source) ? source.replace(pattern, replacement) : `${source}\n${replacement}\n`)
    return
  }
  if (fs.existsSync(mzPath)) {
    const pattern = /Game_System\.prototype\.mainFontSize = function\(\)\s*\{\s*return\s+[0-9]+;?\s*\};?/
    const replacement = `Game_System.prototype.mainFontSize = function() {return ${size};};`
    const source = readTextFile(mzPath)
    atomicWriteTextFile(mzPath, pattern.test(source) ? source.replace(pattern, replacement) : `${source}\n${replacement}\n`)
    return
  }
  throw new Error('MV/MZ 폰트 설정 스크립트를 찾을 수 없습니다')
}
