import { AppContext } from '../appContext';
import { AppSettings } from '../types/settings';
import { applyValidatedSettingsUpdate } from '../ts/libs/settingsRuntimeValidation';
import Themes from '../ts/rpgmv/styles';
import { storage } from './shared';

/** Publish the new runtime settings only after persistence succeeds. */
export function commitSettings(ctx: AppContext, update: unknown): AppSettings {
  const next = applyValidatedSettingsUpdate(ctx.settings, update);
  next.themeData = (Themes as Record<string, Record<string, string>>)[next.theme] ?? {};
  storage.set('settings', JSON.stringify(next));
  ctx.settings = next;
  return next;
}
