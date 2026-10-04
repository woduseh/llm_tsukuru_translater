import { onUnmounted } from 'vue'
import type { ElectronApi, IpcCallback, ReceiveChannel } from '../../types/ipc'

interface NodeFs {
  readTextFile: (filePath: string) => Promise<string>
  readDirectory: (dirPath: string) => Promise<string[]>
  readFileSync: (filePath: string, encoding?: string) => string
  readdirSync: (dirPath: string) => string[]
  existsSync: (filePath: string) => boolean
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

export const api: ElectronApi = window.api

/** Register an IPC listener that auto-cleans on component unmount */
export function useIpcOn<C extends ReceiveChannel>(channel: C, callback: IpcCallback<C>) {
  const unsubscribe = api.on(channel, callback)
  onUnmounted(() => {
    unsubscribe?.()
  })
}
