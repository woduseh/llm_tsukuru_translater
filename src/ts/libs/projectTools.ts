import { AppContext } from '../../appContext';

interface PTools{
    send: (channel: string, ...args: unknown[]) => void;
    packed?: boolean;
    sendError: (txt: string) => void;
    sendAlert: (txt: string) => void;
    worked: () => void;
    init: (ctx: AppContext) => void;
}


function INIT(ctx: AppContext){
    pTools = {
        send: (channel: string, ...args: unknown[]) => {
            ctx.mainWindow!.webContents.send(channel, ...args);
        },
        sendError: (txt:string) => {
            ctx.mainWindow!.webContents.send('alert', {icon: 'error',  message: txt});
        },
        sendAlert: (txt:string) => {
            ctx.mainWindow!.webContents.send('alert', txt);
        },
        worked: () => {
            ctx.mainWindow!.webContents.send('worked', 0);
            ctx.mainWindow!.webContents.send('loading', 0);
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
}


export default Tools