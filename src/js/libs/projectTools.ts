import { rmBom } from './fileIO';

interface PTools{
    send: (channel: string, ...args: unknown[]) => void;
    packed?: boolean;
    sendError: (txt: string) => void;
    sendAlert: (txt: string) => void;
    worked: () => void;
    init: () => void;
}


function INIT(){
    pTools = {
        send: (channel: string, ...args: unknown[]) => {
            globalThis.mwindow.webContents.send(channel, ...args);
        },
        sendError: (txt:string) => {
            globalThis.mwindow.webContents.send('alert', {icon: 'error',  message: txt});
        },
        sendAlert: (txt:string) => {
            globalThis.mwindow.webContents.send('alert', txt);
        },
        worked: () => {
            globalThis.mwindow.webContents.send('worked', 0);
            globalThis.mwindow.webContents.send('loading', 0);
        },
        init: () => {}
    }
}

function callBeforeInit(){console.error('Ptools called before init')}

let pTools:PTools = {
    send: (channel: string, ...args: unknown[]) => {callBeforeInit()},
    sendError: (txt: string) => {callBeforeInit()},
    sendAlert: (txt: string) => {callBeforeInit()},
    worked: () => {callBeforeInit()},
    init: INIT
}



const Tools = {
    send: (channel: string, ...args: unknown[]) => {pTools.send(channel, ...args)},
    packed: ((require.main && require.main.filename.indexOf('app.asar') !== -1) || (process.argv.filter(a => a.indexOf('app.asar') !== -1).length > 0)),
    sendError: (txt: string) => {pTools.sendError(txt)},
    sendAlert: (txt: string) => {pTools.sendAlert(txt)},
    worked: () => {pTools.worked()},
    setProgress: (now: number, max: number, multiplier: number = 100) => {
        pTools.send('loading', (now / max) * multiplier);
    },
    init: INIT,
    rmBom
}


export default Tools