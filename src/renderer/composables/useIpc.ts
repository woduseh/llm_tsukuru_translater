import { onUnmounted } from 'vue'

interface ElectronApi {
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, callback: (...args: any[]) => void) => void
  once: (channel: string, callback: (...args: any[]) => void) => void
  removeAllListeners: (channel: string) => void
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

interface NodeFs {
  readFileSync: (filePath: string, encoding?: string) => string
  readdirSync: (dirPath: string) => string[]
  existsSync: (filePath: string) => boolean
  writeFileSync: (filePath: string, data: string, encoding?: string) => void
}

interface NodePath {
  join: (...args: string[]) => string
  parse: (p: string) => { dir: string; root: string; base: string; name: string; ext: string }
  basename: (p: string) => string
}

interface NodeBuffer {
  toBase64: (str: string) => string
  fromBase64: (str: string) => string
}

interface Verify {
  verifyJsonIntegrity: (orig: unknown, trans: unknown) => unknown[]
  repairJson: (orig: unknown, trans: unknown) => unknown
}

declare global {
  interface Window {
    api: ElectronApi
    nodeFs: NodeFs
    nodePath: NodePath
    nodeBuffer: NodeBuffer
    verify: Verify
    Swal: any
  }
}

export const api = {
  send: (channel: string, ...args: unknown[]) => window.api.send(channel, ...args),
  on: (channel: string, callback: (...args: any[]) => void) => window.api.on(channel, callback),
  once: (channel: string, callback: (...args: any[]) => void) => window.api.once(channel, callback),
  removeAllListeners: (channel: string) => window.api.removeAllListeners(channel),
  invoke: (channel: string, ...args: unknown[]) => window.api.invoke(channel, ...args),
}

/** Register an IPC listener that auto-cleans on component unmount */
export function useIpcOn(channel: string, callback: (...args: any[]) => void) {
  api.on(channel, callback)
  onUnmounted(() => {
    api.removeAllListeners(channel)
  })
}
