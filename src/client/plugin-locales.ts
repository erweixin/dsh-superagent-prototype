/** Locale composition stays separate from React plugin code to avoid loading UI through dictionaries. */
import { feishuLocales } from '../integrations/feishu/client/locales.ts'
export const sourcePluginLocales = { ...feishuLocales }
