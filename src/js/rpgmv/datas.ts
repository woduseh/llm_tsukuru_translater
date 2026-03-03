import { AppSettings } from '../../types/settings'

const styles = require('./styles').default

export const settings: AppSettings = {
    extractJs: false,
    extractSomeScript: false,
    extractSomeScript2: [],
    code122: false,
    onefile_src: true,
    onefile_note: true,
    exJson: false,
    loadingText: true,
    JsonChangeLine: false,
    ExtractAddLine: false,
    oneMapFile: false,
    ExternMsgJson: true,
    DoNotTransHangul: true,
    formatNice: true,
    theme: "Dracula",
    themeData: {},
    extractPlus: [],
    themeList: Object.keys(styles),
    language: 'en',
    HideExtractAll: true,
    llmApiKey: '',
    llmModel: 'gemini-3.0-flash-preview',
    llmCustomPrompt: '',
    llmChunkSize: 30,
    llmTranslationUnit: 'chunk',
    llmTargetLang: 'ko'
}

export const onebyone = {
    'Actors.json': 'actor',
    'Armors.json': 'item',
    'Classes.json': 'class',
    'CommonEvents.json': 'events',
    'Skills.json': 'skill',
    'States.json': 'state',
    'System.json': 'sys',
    'Enemies.json': 'ene',
    'Weapons.json': 'item',
    'Items.json': 'item',
    'ext_plugins.json': 'plugin',
    'Troops.json': 'ene2'
}

const odat = [
    'Actors.txt',
    'Armors.txt',
    'Classes.txt',
    'CommonEvents.txt',
    'Skills.txt',
    'States.txt',
    'System.txt',
    'Enemies.txt',
    'Troops.txt',
    'Weapons.txt',
    'Items.txt',
]
export default odat

export const ignores = [
    'Actors.json',
    'Animations.json',
    'Armors.json',
    'Classes.json',
    'CommonEvents.json',
    'Enemies.json',
    'Items.json',
    'Skills.json',
    'States.json',
    'System.json',
    'Tilesets.json',
    'Troops.json',
    'Weapons.json'
]

export const translateable = [
    '<profile:',
    '<desc1:',
    '<desc2:',
    '<desc3:',
    '<SG説明',
    '<SG説明2:',
    "<namePop:",
    "<SGカテゴリ:",
    '<shop_mes:',
]

export const translateableOne = [
    "<namePop:"
]

export const note2able = [
    '選択肢ヘルプ',
]

export const hanguls = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;

export const beautifyCodes = [
    108
]

export const beautifyCodes2 = [
    355,356,357
]