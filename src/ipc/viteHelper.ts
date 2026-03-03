import { BrowserWindow, app } from 'electron';
import path from 'path';

const VITE_DEV_SERVER_URL = 'http://localhost:5173';

/** Whether we're running in dev mode (Vite dev server available) */
export function isDev(): boolean {
  return !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL;
}

/** Load a Vue route in a BrowserWindow */
export function loadRoute(win: BrowserWindow, route: string = '/') {
  if (isDev()) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL || VITE_DEV_SERVER_URL}#${route}`);
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'), {
      hash: route,
    });
  }
}
