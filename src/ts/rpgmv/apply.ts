import fs from 'fs';
import * as  ExtTool from './extract/index.js';
import path from 'path';
import * as edTool from './edtool.js';
import yaml from 'js-yaml';
import { sleep } from './globalutils';
import Tools from '../libs/projectTools';
import log from '../../logger';
import { readTextFile, writeTextFile } from '../libs/fileIO';
import { AppContext } from '../../appContext';
import { validateRpgMakerParallelApplySafety } from '../libs/metadataValidation';
import { haveSameTranslationLineStructure } from '../libs/translationSyntax';

import type { ApplyArg } from './types';

function getBinarySize(string: string) {
    return Buffer.byteLength(string, 'utf8');
}
export const apply = async (ev: unknown, arg: ApplyArg, ctx: AppContext) => {
    let completedStash: CompletedOutputStash | null = null
    try {
      const dir = (Buffer.from(arg.dir, "base64").toString('utf8'));
      if (! fs.existsSync(dir + '/Extract')){
        Tools.sendError('Extract 폴더가 존재하지 않습니다');
        Tools.worked();
        return
      }
      if (!edTool.exists(dir)){
        Tools.sendError('.extracteddata 파일이 존재하지 않습니다');
        Tools.worked();
        return
      }
      const jsdir = ((dir.substring(0,dir.length-5) + '/js').replaceAll('//','/'))
      let ext_data = edTool.read(dir)
      const ext_dat = ext_data.main
      const extractedLines: Record<string, string[]> = {}
      const extractTextLineCounts: Record<string, number> = {}
      for (const extractFile of Object.keys(ext_dat)) {
        if (!isSafeRpgMakerJsonFileName(extractFile)) {
          throw new Error(`안전하지 않은 추출 파일 이름입니다: ${extractFile}`)
        }
        const textPath = extractFile === 'ext_javascript.json'
          ? path.join(dir, 'Extract', 'ext_javascript.js')
          : path.join(dir, 'Extract', `${path.parse(extractFile).name}.txt`)
        if (!fs.existsSync(textPath)) {
          throw new Error(`추출 텍스트 파일이 존재하지 않습니다: ${path.basename(textPath)}`)
        }
        const lines = readTextFile(textPath).split('\n')
        extractedLines[extractFile] = lines
        extractTextLineCounts[extractFile] = lines.length
      }
      validateRpgMakerParallelApplySafety(ext_data, { extractTextLineCounts })
      const max_files = Object.keys(ext_dat).length
      let worked_files = 0
      let OutputData: Record<string, any> = {}
      const applyErrors: string[] = []
      for(const i of Object.keys(ext_dat)){
        if(fs.existsSync(dir + '/Backup/' + i)){
          let filedata = readTextFile(dir + '/Backup/' + i)
          try {
            OutputData[i] = JSON.parse(filedata)  
          } catch (error) {
            log.warn('Failed to parse backup file:', i, error)
            applyErrors.push(`${i}: 백업 JSON 파싱 실패`)
          }
        }
      }
      for(const i of Object.keys(ext_dat)){
        worked_files += 1
        if(i.endsWith('.json')){
          const Edata = extractedLines[i]
          for(const q of Object.keys(ext_dat[i].data)){
            let output = ''
            let autoline = false
            let autolineSize = 0
            const entry = ext_dat[i].data[q]
            const originFile = entry.origin ?? i
            if (!isSafeRpgMakerJsonFileName(originFile)) {
              applyErrors.push(`${i}: 안전하지 않은 원본 파일 이름 ${originFile}`)
              continue
            }
            if(!(originFile in OutputData)){
              const sourcePath = path.join(dir, 'Backup', originFile)
              if(fs.existsSync(sourcePath)){
                const filedata = readTextFile(sourcePath)
                try {
                  OutputData[originFile] = JSON.parse(filedata)
                } catch (error) {
                  log.warn('Failed to parse backup JSON:', originFile, error)
                  applyErrors.push(`${originFile}: 백업 JSON 파싱 실패`)
                  continue
                }
              } else {
                applyErrors.push(`${originFile}: 백업 JSON이 존재하지 않음`)
                continue
              }
            }
            const startLine = Number(q)
            const endLine = Number(entry.m)
            if (!Number.isInteger(startLine) || !Number.isInteger(endLine)
              || startLine < 0 || endLine <= startLine || endLine > Edata.length) {
              applyErrors.push(`${i}: 번역 텍스트 줄 범위 ${q}-${String(entry.m)}가 올바르지 않음`)
              continue
            }
            const translatedLines = Edata.slice(startLine, endLine)
            const originalValue = entry.originText ?? ExtTool.getVal(entry.val, OutputData[originFile])
            if (typeof originalValue === 'string'
              && !haveSameTranslationLineStructure(originalValue.split('\n'), translatedLines)) {
              applyErrors.push(`${i}: ${q}-${entry.m} 빈 줄 또는 제어 코드 구조가 원본과 다름`)
              continue
            }
            if(entry.conf !== undefined){
                const econf = entry.conf
                if(arg.autoline && econf.type == 'event' && econf.code == 401){
                    autoline = true
                    autolineSize = econf.face ? 80 : 60
                }
                if(arg.isComment){
                  continue
                }
            }
            for(let x=startLine;x<endLine;x++){
              let forUse = Edata[x]
              if(autoline && (getBinarySize(forUse) > autolineSize)){
                  let v = forUse.split(' ')
                  if(v.length > 1){
                    v[(Math.floor(v.length/2)) - 1] = '\n' + v[(Math.floor(v.length/2)) - 1]
                  }
                  forUse = v.join(' ')
              }
              output += forUse
              if(x !== (endLine - 1)){
                output += '\n'
              }
            }
            try {
              OutputData[originFile] = ExtTool.setObj(entry.val, output, OutputData[originFile])
            } catch (error) {
              log.warn('Failed to set value for:', entry.val, error)
              applyErrors.push(`${originFile}: ${entry.val} 적용 실패`)
            }
          }
        }
        Tools.send('loading', worked_files/max_files*100);
        await sleep(0)
      }

      if (applyErrors.length > 0) {
        const preview = applyErrors.slice(0, 5).join(', ')
        const suffix = applyErrors.length > 5 ? ` 외 ${applyErrors.length - 5}건` : ''
        throw new Error(`적용 사전 검증에 실패했습니다: ${preview}${suffix}`)
      }

      // Generate the complete output in an isolated Completed tree first.
      // Instant apply commits that tree transactionally only after generation
      // and media encryption have both succeeded.
      const completedDir = dir + '/Completed'
      completedStash = stashCompletedOutput(completedDir)
      fs.mkdirSync(completedDir + '/data', { recursive: true })
      fs.mkdirSync(completedDir + '/js', { recursive: true })

      for(const i of Object.keys(OutputData)){
        const data = OutputData[i]
        if(i == 'ext_plugins.json'){
          const vaq = `var $plugins = ${JSON.stringify(data)};`
          writeTextFile(dir + '/Completed/js/plugins.js', vaq)
        }
        else if(i == 'ExternMsgcsv.json'){
          await ExtTool.pack_externMsg(dir + '/Completed/data/ExternMessage.csv', data)
        }
        else{
          const fdir = path.join(dir,'Completed','data',i)
          const fdir2 = path.join(dir,'Completed','data', `${i}.yaml`)
          const fd = arg.useYaml ? fdir2 : fdir
          const dataJson = arg.useYaml ? yaml.dump(data) : JSON.stringify(data, null, 4*Number(ctx.settings.JsonChangeLine))
          writeTextFile(fd, dataJson)
          if(arg.useYaml && fs.existsSync(fdir)){
            fs.rmSync(fdir)
          }
          else if((!arg.useYaml) && fs.existsSync(fdir2)){
            fs.rmSync(fdir2)
          }
        }
      }
      
      await ExtTool.EncryptDir(dir, 'img', false)
      await ExtTool.EncryptDir(dir, 'audio', false)

      if (completedStash) {
        if (arg.instantapply) {
          commitCompletedOutput(dir, jsdir, OutputData, !!arg.useYaml)
          restoreCompletedOutput(completedStash)
        } else {
          discardCompletedOutputStash(completedStash)
        }
        completedStash = null
      }
      Tools.send('alert2');
      Tools.send('loading', 0);
    } catch (err) {
      if (completedStash) {
        try {
          restoreCompletedOutput(completedStash)
        } catch (restoreError) {
          log.error('Failed to restore previous Completed output:', restoreError)
        }
      }
      log.error('Apply failed:', err);
      Tools.sendError(JSON.stringify(err, Object.getOwnPropertyNames(err)));
    }
    Tools.worked();
}

interface CompletedOutputStash {
  completedDir: string
  previousDir?: string
}

function stashCompletedOutput(completedDir: string): CompletedOutputStash {
  if (!fs.existsSync(completedDir)) return { completedDir }
  const previousDir = path.join(
    path.dirname(completedDir),
    `.Completed.previous-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  fs.renameSync(completedDir, previousDir)
  return { completedDir, previousDir }
}

function restoreCompletedOutput(stash: CompletedOutputStash): void {
  if (fs.existsSync(stash.completedDir)) {
    fs.rmSync(stash.completedDir, { recursive: true, force: true })
  }
  if (stash.previousDir && fs.existsSync(stash.previousDir)) {
    fs.renameSync(stash.previousDir, stash.completedDir)
  }
}

function discardCompletedOutputStash(stash: CompletedOutputStash): void {
  if (!stash.previousDir || !fs.existsSync(stash.previousDir)) return
  try {
    fs.rmSync(stash.previousDir, { recursive: true, force: true })
  } catch (error) {
    log.warn('Failed to remove previous Completed output:', stash.previousDir, error)
  }
}

interface LiveOutputOperation {
  targetPath: string
  stagedPath?: string
}

interface PreparedLiveOutput extends LiveOutputOperation {
  tempPath?: string
  previousPath: string
  previousMoved: boolean
  installed: boolean
}

export function commitCompletedOutput(
  dataDir: string,
  jsDir: string,
  outputData: Record<string, unknown>,
  useYaml: boolean,
): void {
  const completedDir = path.join(dataDir, 'Completed')
  const projectRoot = path.dirname(dataDir)
  const operations = new Map<string, LiveOutputOperation>()
  const normalizeKey = (targetPath: string) => {
    const resolved = path.resolve(targetPath)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const addOperation = (operation: LiveOutputOperation) => {
    operations.set(normalizeKey(operation.targetPath), operation)
  }
  const addTree = (sourceRoot: string, targetRoot: string) => {
    if (!fs.existsSync(sourceRoot)) return
    for (const stagedPath of listFilesRecursively(sourceRoot)) {
      addOperation({
        stagedPath,
        targetPath: path.join(targetRoot, path.relative(sourceRoot, stagedPath)),
      })
    }
  }

  addTree(path.join(completedDir, 'data'), dataDir)
  addTree(path.join(completedDir, 'js'), jsDir)
  addTree(path.join(completedDir, 'img'), path.join(projectRoot, 'img'))
  addTree(path.join(completedDir, 'audio'), path.join(projectRoot, 'audio'))

  // Switching JSON/YAML mode also removes the obsolete counterpart as part
  // of the same rollback-capable commit.
  for (const fileName of Object.keys(outputData)) {
    if (fileName === 'ext_plugins.json' || fileName === 'ExternMsgcsv.json') continue
    const obsoletePath = useYaml
      ? path.join(dataDir, fileName)
      : path.join(dataDir, `${fileName}.yaml`)
    const key = normalizeKey(obsoletePath)
    if (!operations.has(key)) addOperation({ targetPath: obsoletePath })
  }

  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const prepared: PreparedLiveOutput[] = [...operations.values()].map((operation, index) => ({
    ...operation,
    tempPath: operation.stagedPath
      ? path.join(path.dirname(operation.targetPath), `.${path.basename(operation.targetPath)}.apply-${suffix}-${index}.tmp`)
      : undefined,
    previousPath: path.join(
      path.dirname(operation.targetPath),
      `.${path.basename(operation.targetPath)}.previous-${suffix}-${index}`,
    ),
    previousMoved: false,
    installed: false,
  }))

  try {
    // Prepare every replacement before touching a live file.
    for (const item of prepared) {
      if (!item.stagedPath || !item.tempPath) continue
      fs.mkdirSync(path.dirname(item.targetPath), { recursive: true })
      fs.copyFileSync(item.stagedPath, item.tempPath, fs.constants.COPYFILE_EXCL)
    }

    for (const item of prepared) {
      if (fs.existsSync(item.targetPath)) {
        fs.renameSync(item.targetPath, item.previousPath)
        item.previousMoved = true
      }
      if (item.tempPath) {
        fs.renameSync(item.tempPath, item.targetPath)
        item.installed = true
      }
    }
  } catch (error) {
    const rollbackErrors: string[] = []
    for (const item of [...prepared].reverse()) {
      try {
        if (item.installed && fs.existsSync(item.targetPath)) {
          fs.rmSync(item.targetPath, { recursive: true, force: true })
        }
        if (item.previousMoved && fs.existsSync(item.previousPath)) {
          fs.renameSync(item.previousPath, item.targetPath)
        }
      } catch (rollbackError) {
        rollbackErrors.push(`${item.targetPath}: ${(rollbackError as Error).message || String(rollbackError)}`)
      }
      if (item.tempPath && fs.existsSync(item.tempPath)) {
        try { fs.rmSync(item.tempPath, { force: true }) } catch { /* keep the rollback error below */ }
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`즉시 적용과 복구가 모두 실패했습니다: ${(error as Error).message}; ${rollbackErrors.join(', ')}`)
    }
    throw error
  }

  for (const item of prepared) {
    if (!item.previousMoved || !fs.existsSync(item.previousPath)) continue
    try {
      fs.rmSync(item.previousPath, { recursive: true, force: true })
    } catch (error) {
      log.warn('Failed to remove instant-apply rollback file:', item.previousPath, error)
    }
  }
}

function listFilesRecursively(directory: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFilesRecursively(candidate))
    else if (entry.isFile()) files.push(candidate)
  }
  return files
}

function isSafeRpgMakerJsonFileName(fileName: string): boolean {
  return path.basename(fileName) === fileName
    && fileName !== '.'
    && fileName !== '..'
    && fileName.toLowerCase().endsWith('.json')
}
