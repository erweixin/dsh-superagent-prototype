/** Compile-time browser plugin composition. Remove an entry to omit its custom settings UI. */
import type { SourceClientPlugin } from './source-plugins.tsx'
import { feishuClientPlugin } from '../integrations/feishu/client/plugin.tsx'
export const installedSourceClients: readonly SourceClientPlugin[] = [feishuClientPlugin]
