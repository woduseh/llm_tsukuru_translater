import { onUnmounted } from 'vue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IpcCallback = (...args: any[]) => void

interface ElectronApi {
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, callback: IpcCallback) => void
  once: (channel: string, callback: IpcCallback) => void
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
  getAtPath: (obj: unknown, path: string) => unknown
  setAtPath: (obj: unknown, path: string, value: unknown) => boolean
}

declare global {
  interface Window {
    api: ElectronApi
    nodeFs: NodeFs
    nodePath: NodePath
    nodeBuffer: NodeBuffer
    verify: Verify
    Swal: typeof import('sweetalert2').default
  }
}

export const api = {
  send: (channel: string, ...args: unknown[]) => window.api.send(channel, ...args),
  on: (channel: string, callback: IpcCallback) => window.api.on(channel, callback),
  once: (channel: string, callback: IpcCallback) => window.api.once(channel, callback),
  removeAllListeners: (channel: string) => window.api.removeAllListeners(channel),
  invoke: (channel: string, ...args: unknown[]) => window.api.invoke(channel, ...args),
}

/** Register an IPC listener that auto-cleans on component unmount */
export function useIpcOn(channel: string, callback: IpcCallback) {
  api.on(channel, callback)
  onUnmounted(() => {
    api.removeAllListeners(channel)
  })
}
