import { constants } from 'node:fs'
import { mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Commands } from '../infra/commands.ts'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** Upload a bounded snapshot of a workspace image, not an arbitrary path exposed to the main Session. */
export async function uploadFeishuImage(commands: Pick<Commands, 'lark'>, directory: string, path: string): Promise<string> {
  if (isAbsolute(path)) throw new Error('Image path must be relative to the ticket workspace')
  const base = await realpath(directory)
  const file = await realpath(resolve(base, path))
  const rel = relative(base, file)
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Image is outside the ticket workspace')
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  let data: Buffer
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size === 0 || info.size > MAX_IMAGE_BYTES) throw new Error('Image must be a nonempty file of at most 10 MB')
    const buffer = Buffer.alloc(MAX_IMAGE_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (!length || length > MAX_IMAGE_BYTES) throw new Error('Image must be a nonempty file of at most 10 MB')
    data = buffer.subarray(0, length)
  } finally { await handle.close() }
  const ext = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'jpg'
    : /^GIF8[79]a$/.test(data.toString('ascii', 0, 6)) ? 'gif'
    : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : undefined
  if (!ext) throw new Error('Unsupported image contents; use PNG, JPEG, GIF or WebP')
  // CLI paths must be relative. A private snapshot also keeps retries/uploads from following a changed workspace file.
  const staging = await mkdtemp(join(tmpdir(), 'superagent-image-'))
  try {
    const name = `image.${ext}`
    await writeFile(join(staging, name), data, { mode: 0o600 })
    const result = await commands.lark<{ image_key?: string }>(['im', 'images', 'create', '--data', JSON.stringify({ image_type: 'message' }), '--file', `./${name}`], staging)
    if (!result?.image_key || !/^img_[A-Za-z0-9_-]+$/.test(result.image_key)) throw new Error('Feishu upload did not return an image_key')
    return result.image_key
  } finally { await rm(staging, { recursive: true, force: true }) }
}
