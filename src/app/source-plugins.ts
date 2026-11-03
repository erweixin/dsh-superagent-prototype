/** Server composition: the only place the runtime chooses built-in external sources. */
import { feishuKind } from '../integrations/feishu/server/source.ts'
import type { SourceKind } from '../sources/kind.ts'
export const installedSourceKinds: readonly SourceKind[] = [feishuKind as SourceKind]
