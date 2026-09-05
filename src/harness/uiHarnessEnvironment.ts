import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// Run before logging, stores, and Chromium initialize their profile paths.
if (process.env.LLM_TSUKURU_UI_HARNESS_SCENARIO) {
  const profile = process.env.LLM_TSUKURU_UI_HARNESS_USER_DATA;
  if (!profile || !path.isAbsolute(profile)) {
    throw new Error('UI harness requires an absolute isolated user-data directory.');
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
}
