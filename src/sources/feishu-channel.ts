/** Feishu outbound channel: posts threaded bot replies and constructs chat deep links. */
import type { OutboundMessage } from '../core/index.ts'
import { CliError } from '../infra/commands.ts'
import { checkedImText } from '../infra/text.ts'
import type { SourceContext } from './host.ts'
import type { ChannelLink, ChannelLinks } from './kind.ts'
import { feishuTriggerId } from './feishu-trigger.ts'
import { checkedImages } from '../core/message-images.ts'

/** Feishu or Lark AppLink that opens a chat; used when the message's own link was not delivered with the event. */
export const feishuChatLink = (brand: 'feishu' | 'lark', chatId: string): string =>
  `https://applink.${brand === 'lark' ? 'larksuite.com' : 'feishu.cn'}/client/chat/open?openChatId=${encodeURIComponent(chatId)}`
/**
 * True when Feishu permanently rejects a reply because the target message was recalled, withdrawn, or not found.
 * Only a Feishu response carrying one of these error codes means the target message is gone; timeouts or crashes do not.
 */
const gone = (error: unknown): boolean => error instanceof CliError && error.code !== undefined && (error.code === 230011
  || /withdrawn/i.test(error.message) || (Math.floor(error.code / 100) === 2300 && /not found/i.test(error.message)))
/** Replies in the topic of the target message; Feishu keeps at most one reply per idempotency key (the outgoing message's `message.id`). */
export async function sendFeishu(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const messageId = message.channel.address.messageId
  const chatId = message.channel.address.chatId
  if (!messageId && !chatId) throw new Error('Missing Feishu reply target')
  const images = checkedImages(message.images)
  const text = message.text
  checkedImText([text, ...images.map(image => image.alt ?? '')].join('\n'))
  const content = images.length ? ['--msg-type', 'post', '--content', JSON.stringify({ zh_cn: { content: [
    [{ tag: 'md', text }],
    ...images.flatMap(image => [
      [{ tag: 'img', image_key: image.imageKey }],
      ...(image.alt ? [[{ tag: 'text', text: image.alt }]] : [])
    ])
  ] } })] : ['--markdown', text]
  const reply = ['im', ...(messageId ? ['+messages-reply', '--message-id', messageId, '--reply-in-thread'] : ['+messages-send', '--chat-id', chatId!]),
    ...content, '--idempotency-key', message.id]
  try {
    const result = await host.commands.lark<{ message_id?: string }>(reply)
    if (images.length && !result?.message_id?.startsWith('om_')) throw new Error('Feishu image message did not return a message_id; delivery is unconfirmed')
  }
  catch (error) {
    if (gone(error)) return 'gone'
    throw error
  }
  return 'sent'
}
/** Fallback chat link on the bot's brand; the message's own deep link on its Trigger is preferred when available. */
export const feishuLink = (address: Record<string, string>, links: ChannelLinks): ChannelLink => ({
  url: feishuChatLink(links.feishu?.brand ?? 'feishu', address.chatId ?? ''), label: { zh: '飞书消息', en: 'Feishu message' },
  ...address.messageId ? { triggerId: feishuTriggerId(address.messageId) } : {},
})
