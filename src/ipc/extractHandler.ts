import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import * as ExtTool from '../ts/rpgmv/extract/index.js';
import * as edTool from '../ts/rpgmv/edtool.js';
import * as dataBaseO from '../ts/rpgmv/datas.js';
import { checkIsMapFile, sleep } from '../ts/rpgmv/globalutils.js';
import * as yaml from 'js-yaml';
import { sendError, worked } from './shared';
import log from '../logger';
import { AppContext } from '../appContext';
import { migrateVersionText } from '../ts/rpgmv/versionUp';
import { createTranslationBackup } from '../ts/rpgmv/translator';

import { ExtractArg, VersionUpRequest } from '../ts/rpgmv/types';

export function registerExtractHandlers(ctx: AppContext) {
  const ErrorAlert = (msg: string) => sendError(ctx, msg)

  async function extractor(arg: ExtractArg): Promise<boolean> {
    let extractionStash: ExtractionArtifactStash | null = null
    const temporaryJsonPaths: string[] = []
    let createdPluginJson = false
    let createdExternMessageJson = false
    let extractionDir = ''
    try {
      ctx.gb = {}
      let file
      const dir = Buffer.from(arg.dir, "base64").toString('utf8');
      extractionDir = dir
      if(!fs.existsSync(dir)){
        ctx.mainWindow!.webContents.send('alert', {icon: 'error', message: '지정된 디렉토리가 없습니다'}); 
        if (!arg.silent) worked(ctx)
        return false
      }
      if(path.parse(dir).name !== 'data' && (!arg.force)){
        ctx.mainWindow!.webContents.send('alert', {icon: 'error', message: 'data 폴더가 아닙니다'}); 
        if (!arg.silent) worked(ctx)
        return false
      }
      const hasExistingExtract = fs.existsSync(dir + '/Extract')
      if(hasExistingExtract && !arg.force){
        ctx.mainWindow!.webContents.send('check_force', arg);
        if (!arg.silent) worked(ctx)
        return false
      }
      if(arg.ext_plugin){
          const pluginJsonPath = path.join(dir, 'ext_plugins.json')
          if (fs.existsSync(pluginJsonPath)) {
            throw new Error('ext_plugins.json과 임시 추출 파일 이름이 충돌합니다.')
          }
          let jsdir = ((dir.substring(0,dir.length-5) + '/js').replaceAll('//','/'))
          if(!fs.existsSync(jsdir + '/plugins.js')){
            jsdir = path.join(path.dirname(path.dirname(path.dirname(jsdir))), 'js')
            if(!fs.existsSync(jsdir + '/plugins.js')){
              ctx.mainWindow!.webContents.send('alert', {icon: 'error', message: 'plugin.js가 존재하지 않습니다'}); 
              if (!arg.silent) worked(ctx)
              return false
            }
          }
          let hail2 = fs.readFileSync(jsdir + '/plugins.js', 'utf-8')
          let hail = hail2.split('$plugins =')
          hail2 = hail[hail.length - 1] + '  '
          hail2 = hail2.substring(hail2.indexOf('['), hail2.lastIndexOf(']') + 1)
          fs.writeFileSync(pluginJsonPath, JSON.stringify(JSON.parse(hail2)), 'utf-8')
          createdPluginJson = true
      }
      ctx.externMsg = {}
      ctx.useExternMsg = false
      if(fs.existsSync(dir + '/ExternMessage.csv') && arg.exJson && ctx.settings.ExternMsgJson){
        const Emsg = await ExtTool.parse_externMsg(dir + '/ExternMessage.csv', !ctx.settings.ExternMsgJson) as Record<string, string>
        ctx.externMsg = Emsg
        if(ctx.settings.ExternMsgJson){
          const externMessageJsonPath = path.join(dir, 'ExternMsgcsv.json')
          if (fs.existsSync(externMessageJsonPath)) {
            throw new Error('ExternMsgcsv.json과 임시 추출 파일 이름이 충돌합니다.')
          }
          fs.writeFileSync(externMessageJsonPath, JSON.stringify(Emsg, null, 4), 'utf-8')
          createdExternMessageJson = true
        }
        else{
          ctx.useExternMsg = true
          ctx.externMsgKeys = Object.keys(Emsg)
        }
      }
      const fileList2 = fs.readdirSync(dir)
      const yamlConversions = fileList2
        .filter(fileName => fileName.endsWith('.json.yaml'))
        .map(fileName => {
          const sourcePath = path.join(dir, fileName)
          const parsed = path.parse(sourcePath)
          const targetPath = path.join(parsed.dir, parsed.name)
          if (fs.existsSync(targetPath)) {
            throw new Error(`${fileName}의 임시 JSON 경로가 기존 ${path.basename(targetPath)}과 충돌합니다.`)
          }
          return {
            targetPath,
            content: JSON.stringify(yaml.load(fs.readFileSync(sourcePath, 'utf-8'))),
          }
        })
      for (const conversion of yamlConversions) {
        fs.writeFileSync(conversion.targetPath, conversion.content, 'utf-8')
        temporaryJsonPaths.push(conversion.targetPath)
      }

      const fileList = fs.readdirSync(dir)

      // Keep the prior Extract/Backup pair recoverable until every extraction
      // and optional media-decryption step has completed successfully.
      extractionStash = stashExtractionArtifacts(dir, [
        'Extract',
        'Backup',
        'Extract_backup',
        '.extracteddata',
        ...(arg.decryptImg ? ['Extract_img'] : []),
        ...(arg.decryptAudio ? ['Extract_audio'] : []),
      ])

      if (! fs.existsSync(dir + '/Extract')){
        fs.mkdirSync(dir + '/Extract')
      }
      if (! fs.existsSync(dir + '/Backup')){
        fs.mkdirSync(dir + '/Backup')
      }
      const onebyone = dataBaseO.onebyone

      const max_files = fileList.length
      let worked_files = 0
      // Finish the complete backup phase before parsing any source file. A
      // failed copy now aborts extraction instead of producing a partial
      // backup that is later presented as successful.
      for (const fileName of fileList) {
        if(path.parse(fileName).ext !== '.json') continue
        fs.copyFileSync(path.join(dir, fileName), path.join(dir, 'Backup', fileName))
      }
      ExtTool.init_extract(arg, ctx)
      for (const i in fileList){
        worked_files += 1
        const fileName = fileList[i]
        if(path.parse(fileName).ext != '.json'){
          continue
        }
        const conf = {
          extended: true,
          fileName: fileName,
          dir: dir,
          srce: arg.ext_src,
          autoline: arg.autoline,
          note: arg.ext_note,
          arg: arg
        }
        if (checkIsMapFile(fileName)){
          file = fs.readFileSync(dir + '/' + fileName, 'utf8')
          await ExtTool.format_extracted(await ExtTool.extract(file, conf, 'map', ctx), 0, ctx)
        }
        else if (Object.keys(onebyone).includes(fileName)){
          file = fs.readFileSync(dir + '/' + fileName, 'utf8')
          await ExtTool.format_extracted(await ExtTool.extract(file, conf, (onebyone as Record<string, string>)[fileName] as import('../ts/rpgmv/types').ExtractFileType, ctx), 0, ctx)
        }
        else if (arg.exJson){
          if(!dataBaseO.ignores.includes(fileName)){
            file = fs.readFileSync(dir + '/' + fileName, 'utf8')
            await ExtTool.format_extracted(await ExtTool.extract(file, conf, 'ex', ctx), 0, ctx)
          }
        }
        ctx.mainWindow!.webContents.send('loading', worked_files/max_files*100);
        await sleep(0)
      }
      const gbKeys = {...Object.keys(ctx.gb)}
      for (const i in gbKeys){
        const fileName = gbKeys[i]
        if(ctx.gb[fileName].outputText === ''){
          delete ctx.gb[fileName]
        }
        else if(fileName === 'ext_javascript.json'){
          fs.writeFileSync(dir + `/Extract/${path.parse(fileName).name}.js`, ctx.gb[fileName].outputText!,'utf-8')
          delete ctx.gb[fileName].outputText
        }
        else{
          fs.writeFileSync(dir + `/Extract/${path.parse(fileName).name}.txt`, ctx.gb[fileName].outputText!,'utf-8')
          delete ctx.gb[fileName].outputText
        }
      }
      const ext_data = {
        main: ctx.gb
      }
      edTool.write(dir, ext_data)
      ctx.mainWindow!.webContents.send('loading', 0);
      if(arg.decryptImg){
        await ExtTool.DecryptDir(dir, 'img')
      }
      if(arg.decryptAudio){
        await ExtTool.DecryptDir(dir, 'audio')
      }
      if(!arg.silent){
        ctx.mainWindow!.webContents.send('alert2'); 
      }
      if (extractionStash) {
        discardExtractionArtifactStash(extractionStash)
        extractionStash = null
      }
      return true
    } catch (err) {
      if (extractionStash) {
        try {
          restoreExtractionArtifacts(extractionStash)
        } catch (restoreError) {
          log.error('Failed to restore prior extraction artifacts:', restoreError)
        }
      }
      log.error('Extraction failed:', err);
      ctx.mainWindow!.webContents.send('alert', {icon: 'error', message: JSON.stringify(err, Object.getOwnPropertyNames(err))}); 
      return false
    } finally {
      if (extractionDir) {
        removeTemporaryExtractionFile(path.join(extractionDir, 'ext_plugins.json'), createdPluginJson)
        removeTemporaryExtractionFile(path.join(extractionDir, 'ExternMsgcsv.json'), createdExternMessageJson)
      }
      for (const temporaryPath of temporaryJsonPaths) {
        removeTemporaryExtractionFile(temporaryPath, true)
      }
    }
  }

  ipcMain.on('extract', async (ev, arg) => {
    await extractor(arg)
    worked(ctx)
  })

  ipcMain.on('updateVersion', async (_ev, input: unknown) => {
    let newVersionStash: VersionUpArtifactStash | null = null
    try {
      const request = validateVersionUpRequest(input)
      const translatedExtractDir = path.join(request.oldTranslatedDir, 'Extract')
      if (!isDirectory(translatedExtractDir)) {
        throw new Error('구버전 번역본의 Extract 폴더가 존재하지 않습니다.')
      }

      const extractionOptions: ExtractArg = {
        ...request.extractOptions,
        dir: '',
        force: true,
        silent: true,
        decryptImg: false,
        decryptAudio: false,
      }

      const oldOriginalFiles = await extractVersionSourceTemporarily(
        request.oldOriginalDir,
        extractionOptions,
        extractor,
      )
      const oldTranslatedFiles = readVersionTextFiles(translatedExtractDir)

      newVersionStash = stashVersionUpArtifacts(request.newDir)
      const newExtracted = await extractor({
        ...extractionOptions,
        dir: Buffer.from(request.newDir, 'utf8').toString('base64'),
      })
      if (!newExtracted) throw new Error('신버전 데이터 추출에 실패했습니다.')

      const newExtractDir = path.join(request.newDir, 'Extract')
      await createTranslationBackup(newExtractDir)
      const newFiles = readVersionTextFiles(newExtractDir)
      let migratedFiles = 0
      let replacements = 0
      let ambiguousLines = 0
      let skippedFiles = 0
      const candidates = [...newFiles.keys()]

      for (let index = 0; index < candidates.length; index++) {
        const file = candidates[index]
        const oldOriginal = oldOriginalFiles.get(file)
        const oldTranslated = oldTranslatedFiles.get(file)
        if (oldOriginal === undefined || oldTranslated === undefined) {
          skippedFiles++
          continue
        }

        try {
          const result = migrateVersionText(oldOriginal, oldTranslated, newFiles.get(file)!)
          if (result.replacements > 0) {
            fs.writeFileSync(path.join(newExtractDir, file), result.content, 'utf8')
            migratedFiles++
            replacements += result.replacements
          }
          ambiguousLines += result.ambiguousSourceLines.length
        } catch (error) {
          skippedFiles++
          log.warn(`Version update skipped unsafe file: ${file}`, error)
        }

        ctx.mainWindow!.webContents.send('loading', ((index + 1) / Math.max(1, candidates.length)) * 100)
        await sleep(0)
      }

      discardVersionUpStash(newVersionStash)
      newVersionStash = null
      const details = [`${migratedFiles}개 파일`, `${replacements}개 줄 이식`]
      if (ambiguousLines > 0) details.push(`중복 번역 ${ambiguousLines}개 건너뜀`)
      if (skippedFiles > 0) details.push(`호환되지 않는 파일 ${skippedFiles}개 건너뜀`)
      ctx.mainWindow!.webContents.send('alert', `버전 업이 완료되었습니다. (${details.join(', ')})`)
    } catch (err) {
      if (newVersionStash) {
        try {
          restoreVersionUpStash(newVersionStash)
        } catch (restoreError) {
          log.error('Failed to restore version-up artifacts:', restoreError)
        }
      }
      log.error('Version update failed:', err);
      ErrorAlert(err instanceof Error ? err.message : String(err))
    } finally {
      worked(ctx)
    }
  })
}

function removeTemporaryExtractionFile(filePath: string, createdByThisRun: boolean): void {
  if (!createdByThisRun || !fs.existsSync(filePath)) return
  try {
    fs.rmSync(filePath)
  } catch (error) {
    log.warn('Failed to remove temporary extraction file:', filePath, error)
  }
}

interface ExtractionArtifactStash {
  entries: Array<{ currentPath: string; stashedPath?: string }>
}

function stashExtractionArtifacts(dataDir: string, names: string[]): ExtractionArtifactStash {
  const stash: ExtractionArtifactStash = { entries: [] }
  try {
    for (const name of names) {
      const currentPath = path.join(dataDir, name)
      const entry: { currentPath: string; stashedPath?: string } = { currentPath }
      stash.entries.push(entry)
      if (fs.existsSync(currentPath)) {
        const stashedPath = path.join(
          dataDir,
          `.${name}.previous-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        )
        fs.renameSync(currentPath, stashedPath)
        entry.stashedPath = stashedPath
      }
    }
    return stash
  } catch (error) {
    restoreExtractionArtifacts(stash)
    throw error
  }
}

function restoreExtractionArtifacts(stash: ExtractionArtifactStash): void {
  for (const entry of [...stash.entries].reverse()) {
    if (fs.existsSync(entry.currentPath)) {
      fs.rmSync(entry.currentPath, { recursive: true, force: true })
    }
    if (entry.stashedPath && fs.existsSync(entry.stashedPath)) {
      fs.renameSync(entry.stashedPath, entry.currentPath)
    }
  }
}

function discardExtractionArtifactStash(stash: ExtractionArtifactStash): void {
  for (const entry of stash.entries) {
    try {
      if (entry.stashedPath && fs.existsSync(entry.stashedPath)) {
        fs.rmSync(entry.stashedPath, { recursive: true, force: true })
      }
    } catch (error) {
      // A stale hidden backup is preferable to rolling back a completed
      // extraction after another stash entry has already been discarded.
      log.warn('Failed to remove extraction artifact stash:', entry.stashedPath, error)
    }
  }
}

type VersionTextFiles = Map<string, string>

interface VersionUpArtifactStash {
  dataDir: string;
  stashDir: string;
  artifactNames: string[];
}

const VERSION_UP_REPLACED_ARTIFACTS = ['Extract', 'Backup', 'Extract_backup', '.extracteddata'] as const
const VERSION_UP_PRESERVED_ARTIFACTS = ['Extract_img', 'Extract_audio'] as const
const VERSION_UP_ALL_ARTIFACTS = [...VERSION_UP_REPLACED_ARTIFACTS, ...VERSION_UP_PRESERVED_ARTIFACTS] as const

function validateVersionUpRequest(input: unknown): VersionUpRequest {
  if (!input || typeof input !== 'object') throw new Error('버전 업 요청이 올바르지 않습니다.')
  const value = input as Partial<VersionUpRequest>
  const oldTranslatedDir = validateDataDirectory(value.oldTranslatedDir, '구버전 번역본')
  const oldOriginalDir = validateDataDirectory(value.oldOriginalDir, '구버전 원본')
  const newDir = validateDataDirectory(value.newDir, '신버전')
  const distinct = new Set([oldTranslatedDir, oldOriginalDir, newDir].map((dir) => dir.toLowerCase()))
  if (distinct.size !== 3) throw new Error('서로 다른 세 data 폴더를 선택해야 합니다.')

  const options = value.extractOptions && typeof value.extractOptions === 'object' ? value.extractOptions : {}
  return {
    oldTranslatedDir,
    oldOriginalDir,
    newDir,
    extractOptions: {
      ext_src: options.ext_src === true,
      ext_note: options.ext_note === true,
      ext_plugin: options.ext_plugin === true,
      ext_javascript: options.ext_javascript === true,
      exJson: options.exJson === true,
      autoline: options.autoline === true,
    },
  }
}

function validateDataDirectory(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} data 폴더를 선택하세요.`)
  const resolved = path.resolve(value)
  if (!isDirectory(resolved) || path.basename(resolved).toLowerCase() !== 'data') {
    throw new Error(`${label} 경로가 올바른 data 폴더가 아닙니다.`)
  }
  return resolved
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function readVersionTextFiles(extractDir: string): VersionTextFiles {
  const files: VersionTextFiles = new Map()
  if (!isDirectory(extractDir)) return files
  for (const name of fs.readdirSync(extractDir)) {
    const extension = path.extname(name).toLowerCase()
    const filePath = path.join(extractDir, name)
    if ((extension === '.txt' || extension === '.js') && fs.statSync(filePath).isFile()) {
      files.set(name, fs.readFileSync(filePath, 'utf8'))
    }
  }
  return files
}

async function extractVersionSourceTemporarily(
  dataDir: string,
  options: ExtractArg,
  extractor: (arg: ExtractArg) => Promise<boolean>,
): Promise<VersionTextFiles> {
  const stash = stashVersionUpArtifacts(dataDir)
  try {
    const extracted = await extractor({
      ...options,
      dir: Buffer.from(dataDir, 'utf8').toString('base64'),
    })
    if (!extracted) throw new Error('구버전 원본 데이터 추출에 실패했습니다.')
    return readVersionTextFiles(path.join(dataDir, 'Extract'))
  } finally {
    restoreVersionUpStash(stash)
  }
}

function stashVersionUpArtifacts(dataDir: string): VersionUpArtifactStash {
  const stashDir = fs.mkdtempSync(path.join(dataDir, '.version-up-preserve-'))
  const artifactNames: string[] = []
  try {
    for (const name of VERSION_UP_ALL_ARTIFACTS) {
      const source = path.join(dataDir, name)
      if (!fs.existsSync(source)) continue
      fs.renameSync(source, path.join(stashDir, name))
      artifactNames.push(name)
    }
    return { dataDir, stashDir, artifactNames }
  } catch (error) {
    restoreVersionUpStash({ dataDir, stashDir, artifactNames })
    throw error
  }
}

function restoreVersionUpStash(stash: VersionUpArtifactStash): void {
  for (const name of VERSION_UP_ALL_ARTIFACTS) {
    const generated = path.join(stash.dataDir, name)
    if (fs.existsSync(generated)) fs.rmSync(generated, { recursive: true, force: true })
  }
  for (const name of stash.artifactNames) {
    const preserved = path.join(stash.stashDir, name)
    if (fs.existsSync(preserved)) fs.renameSync(preserved, path.join(stash.dataDir, name))
  }
  if (fs.existsSync(stash.stashDir)) fs.rmSync(stash.stashDir, { recursive: true, force: true })
}

function discardVersionUpStash(stash: VersionUpArtifactStash): void {
  for (const name of VERSION_UP_PRESERVED_ARTIFACTS) {
    const generated = path.join(stash.dataDir, name)
    if (fs.existsSync(generated)) fs.rmSync(generated, { recursive: true, force: true })
    const preserved = path.join(stash.stashDir, name)
    if (fs.existsSync(preserved)) fs.renameSync(preserved, generated)
  }
  if (fs.existsSync(stash.stashDir)) fs.rmSync(stash.stashDir, { recursive: true, force: true })
}
