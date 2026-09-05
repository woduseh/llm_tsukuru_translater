export type LlmProvider = 'gemini' | 'vertex' | 'openai' | 'custom-openai' | 'claude';

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'gemini';
export const DEFAULT_LLM_VERTEX_LOCATION = 'global';

export interface AppSettings {
  extractJs: boolean;
  extractSomeScript: boolean;
  extractSomeScript2: string[];
  code122: boolean;
  onefile_src: boolean;
  onefile_note: boolean;
  exJson: boolean;
  loadingText: boolean;
  JsonChangeLine: boolean;
  ExtractAddLine: boolean;
  oneMapFile: boolean;
  ExternMsgJson: boolean;
  DoNotTransHangul: boolean;
  formatNice: boolean;
  theme: string;
  themeData: Record<string, string>;
  extractPlus: number[];
  themeList: string[];
  language: string;
  HideExtractAll: boolean;
  llmApiKey: string;
  llmOpenAiApiKey: string;
  llmCustomApiKey: string;
  llmCustomBaseUrl: string;
  llmClaudeApiKey: string;
  llmProvider: LlmProvider;
  llmModel: string;
  llmMaxTokens: number;
  llmCustomPrompt: string;
  llmChunkSize: number;
  llmMaxRetries: number;
  llmMaxApiRetries: number;
  llmTimeout: number;
  llmParallelWorkers: number;
  llmTranslationUnit: string;
  llmTargetLang: string;
  llmSourceLang?: string;
  llmSortOrder?: string;
  llmVertexServiceAccountJson: string;
  llmVertexLocation: string;
  version?: string;
  [key: string]: any;
}
