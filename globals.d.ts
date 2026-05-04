import { VerifyIssue } from "./src/ts/rpgmv/verify"
import type {
    TerminalEvent,
    TerminalInputRequest,
    TerminalKillRequest,
    TerminalOperationResult,
    TerminalResizeRequest,
    TerminalSessionCreateRequest,
    TerminalSnapshotRequest,
} from './src/types/agentWorkspace';

export type { extData, lenStr, wolfMetadata } from './src/ts/wolf/types';

export declare global {
    interface Window {
        api: {
            send: (channel: string, ...args: unknown[]) => void;
            on: (channel: string, callback: (...args: any[]) => void) => unknown;
            once: (channel: string, callback: (...args: any[]) => void) => void;
            removeAllListeners: (channel: string) => void;
            invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
            terminal: {
                create: (request: TerminalSessionCreateRequest) => Promise<TerminalOperationResult>;
                input: (request: TerminalInputRequest) => Promise<TerminalOperationResult>;
                resize: (request: TerminalResizeRequest) => Promise<TerminalOperationResult>;
                kill: (request: TerminalKillRequest) => Promise<TerminalOperationResult>;
                list: () => Promise<TerminalOperationResult>;
                snapshot: (request: TerminalSnapshotRequest) => Promise<TerminalOperationResult>;
                onEvent: (callback: (event: TerminalEvent) => void) => () => void;
                onSessions: (callback: (result: TerminalOperationResult) => void) => () => void;
            };
        };
        nodeBuffer: {
            toBase64: (str: string) => string;
            fromBase64: (str: string) => string;
        };
        nodeFs: {
            readFileSync: (filePath: string, encoding: string) => string;
            readdirSync: (dirPath: string) => string[];
            existsSync: (filePath: string) => boolean;
            writeFileSync: (filePath: string, data: string, encoding: string) => void;
        };
        nodePath: {
            join: (...args: string[]) => string;
            parse: (p: string) => { root: string; dir: string; base: string; ext: string; name: string };
            basename: (p: string) => string;
        };
        Swal: any;  // third-party SweetAlert2, no type defs
        verify: {
            verifyJsonIntegrity: (orig: unknown, trans: unknown) => VerifyIssue[];
            repairJson: (orig: unknown, trans: unknown) => unknown;
            getAtPath: (obj: unknown, jsonPath: string) => unknown;
            setAtPath: (obj: unknown, jsonPath: string, value: unknown) => boolean;
        };
    }
}
