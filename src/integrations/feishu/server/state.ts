/** Persisted Feishu cursor keys. Keep spellings stable across upgrades. */
import { record, family } from '../../../infra/keys.ts'
export const FEISHU_KV = { chats: record<Record<string, boolean>>('feishu-chats'), history: family<string, [chat: string]>('feishu-history:'),
    topics: family<Record<string, string>, [chat: string]>('feishu-history-threads:'),
    seen: family<string[], [thread: string]>('thread-seen:'), initialized: family<boolean, [thread: string]>('thread-initialized:') }
