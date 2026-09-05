import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

// Run before logging, stores, and Chromium initialize their profile paths.
const devProfile = !app.isPackaged && process.env.LLM_TSUKURU_DEV_USER_DATA;
if (process.env.LLM_TSUKURU_UI_HARNESS_SCENARIO || devProfile) {
  const profile = process.env.LLM_TSUKURU_UI_HARNESS_SCENARIO
    ? process.env.LLM_TSUKURU_UI_HARNESS_USER_DATA : devProfile;
  if (!profile || !path.isAbsolute(profile)) {
    throw new Error('Local runner requires an absolute isolated user-data directory.');
  }
  const userData = path.resolve(profile);
  const sessionData = path.join(userData, 'session');
  const logs = path.join(userData, 'logs');
  for (const directory of [userData, sessionData, logs]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  app.setPath('userData', userData);
  app.setPath('sessionData', sessionData);
  app.setAppLogsPath(logs);
  // Local runners request ordinary app shutdown through their private profile.
  // This uses no global process search, remote debugging port or new IPC channel.
  const stopWatcher = setInterval(() => {
    if (fs.existsSync(path.join(userData, 'stop'))) app.quit();
  }, 100);
  stopWatcher.unref();
  app.once('will-quit', () => clearInterval(stopWatcher));
  if (devProfile) {
    // Existing production signal: the home Vue component mounted through preload.
    ipcMain.once('mainReady', event => {
      const ready = path.join(userData, 'ready.json');
      fs.writeFileSync(`${ready}.tmp`, JSON.stringify({ url: event.sender.getURL() }));
      fs.renameSync(`${ready}.tmp`, ready);
      if (process.env.LLM_TSUKURU_DEV_SMOKE === '1') setTimeout(() => app.quit(), 250);
    });
  }
}
