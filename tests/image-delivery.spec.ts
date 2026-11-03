import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uploadFeishuImage } from '../src/sources/feishu-upload.ts'
import { sendFeishu } from '../src/sources/feishu-channel.ts'
import { CliError, type Commands } from '../src/infra/commands.ts'
import { MessageImagesSchema } from '../src/app/message-images.ts'
import type { OutboundMessage } from '../src/core/index.ts'

const roots: string[] = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5sAAAAASUVORK5CYII=', 'base64')
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'image-delivery-test-'))
  roots.push(root)
  await writeFile(join(root, 'screenshot.png'), png)
  return root
}
it('uploads a snapshot with a relative CLI path and returns a reusable key without sending', async () => {
  const root = await workspace()
  let staging = ''
  const lark = vi.fn(async (args: string[], cwd?: string) => {
    staging = cwd!
    expect(args).toEqual(['im', 'images', 'create', '--data', '{"image_type":"message"}', '--file', './image.png'])
    expect(await readFile(join(cwd!, 'image.png'))).toEqual(png)
    return { image_key: 'img_test' }
  })
  expect(await uploadFeishuImage({ lark } as unknown as Commands, root, 'screenshot.png')).toBe('img_test')
  expect(lark).toHaveBeenCalledOnce()
  expect(existsSync(staging)).toBe(false)
})
it('rejects absolute paths, symlink escapes, non-images and oversized files before upload', async () => {
  const root = await workspace(), other = await workspace(), lark = vi.fn()
  await symlink(join(other, 'screenshot.png'), join(root, 'escape.png'))
  await writeFile(join(root, 'text.png'), 'not an image')
  await writeFile(join(root, 'large.png'), Buffer.alloc(10 * 1024 * 1024 + 1))
  for (const path of [join(root, 'screenshot.png'), 'escape.png', 'text.png', 'large.png'])
    await expect(uploadFeishuImage({ lark }, root, path)).rejects.toThrow()
  expect(lark).not.toHaveBeenCalled()
})
it.each(['failure', 'missing-key'])('does not invent an upload key and removes staging on %s', async mode => {
  const root = await workspace()
  let staging = ''
  const lark = vi.fn(async (_args: string[], cwd?: string) => {
    staging = cwd!
    if (mode === 'failure') throw new Error('upload denied')
    return {}
  })
  await expect(uploadFeishuImage({ lark } as unknown as Commands, root, 'screenshot.png')).rejects.toThrow()
  expect(existsSync(staging)).toBe(false)
})
const message: OutboundMessage = { id: 'delivery-image-1', kind: 'reply', text: '截图如下。',
  channel: { source: 'feishu', thread: 'topic', address: { chatId: 'oc_chat', messageId: 'om_origin' } },
  images: [{ imageKey: 'img_test', alt: '登录页' }] }
it.each([true, false])('sends text and image in one native Feishu post to the original thread (%s)', async thread => {
  const lark = vi.fn().mockResolvedValue({ message_id: 'om_sent' })
  const outgoing = { ...message, channel: { ...message.channel, address: thread ? message.channel.address : { chatId: 'oc_chat' } } }
  expect(await sendFeishu({ commands: { lark } as unknown as Commands }, outgoing)).toBe('sent')
  const args = lark.mock.calls[0]![0] as string[]
  expect(args.slice(0, thread ? 5 : 4)).toEqual(thread
    ? ['im', '+messages-reply', '--message-id', 'om_origin', '--reply-in-thread']
    : ['im', '+messages-send', '--chat-id', 'oc_chat'])
  expect(args.slice(-2)).toEqual(['--idempotency-key', message.id])
  expect(JSON.parse(args[args.indexOf('--content') + 1]!)).toEqual({ zh_cn: { content: [
    [{ tag: 'md', text: '截图如下。' }], [{ tag: 'img', image_key: 'img_test' }], [{ tag: 'text', text: '登录页' }]
  ] } })
})
it('reuses the same image and idempotency key after a failed send, never claiming upload is delivery', async () => {
  const lark = vi.fn().mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce({ message_id: 'om_sent' })
  const host = { commands: { lark } as unknown as Commands }
  await expect(sendFeishu(host, message)).rejects.toThrow('network error')
  expect(await sendFeishu(host, message)).toBe('sent')
  expect(lark.mock.calls[0]).toEqual(lark.mock.calls[1])
  lark.mockResolvedValue({})
  await expect(sendFeishu(host, message)).rejects.toThrow('delivery is unconfirmed')
  lark.mockRejectedValue(new CliError('message withdrawn', 230011))
  expect(await sendFeishu(host, message)).toBe('gone')
})
it('does not accept local paths, base64 or fabricated URL references as image keys', () => {
  for (const image_key of ['./screenshot.png', 'data:image/png;base64,1234', 'https://example.com/a.png'])
    expect(MessageImagesSchema.safeParse([{ image_key }]).success).toBe(false)
})
