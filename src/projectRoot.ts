import { app } from 'electron';

/** Project root directory (where package.json lives). Works in both dev and production (asar). */
export const PROJECT_ROOT = app.getAppPath();
