import {
    AppSettings,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_LLM_VERTEX_LOCATION,
} from '../../types/settings'
import styles from './styles'

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
    llmOpenAiApiKey: '',
    llmCustomApiKey: '',
    llmCustomBaseUrl: 'http://localhost:1234/v1',
    llmClaudeApiKey: '',
    llmProvider: DEFAULT_LLM_PROVIDER,
    llmModel: 'gemini-3.0-flash-preview',
    llmMaxTokens: 4096,
    llmCustomPrompt: '',
    llmChunkSize: 30,
    llmMaxRetries: 2,
    llmMaxApiRetries: 5,
    llmTimeout: 600,
    llmParallelWorkers: 1,
    llmTranslationUnit: 'chunk',
    llmTargetLang: 'ko',
    llmSourceLang: 'ja',
    llmSortOrder: 'name-asc',
    llmVertexServiceAccountJson: '',
    llmVertexLocation: DEFAULT_LLM_VERTEX_LOCATION
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

export const hanguls= /[ㄱ-ㅎㅏ-ㅣ가-힣]/;

export const beautifyCodes = [
    108
]

export const beautifyCodes2 = [
    355,356,357
]
