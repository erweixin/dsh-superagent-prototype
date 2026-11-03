import { z } from 'zod'

export const MessageImagesSchema = z.array(z.object({
  image_key: z.string().regex(/^img_[A-Za-z0-9_-]+$/),
  alt: z.string().max(200).optional(),
}).strict()).max(6).describe('Feishu images uploaded using the same bot. Copy image_key from orchestrator_image_upload or the worker report; never put local paths, URLs or base64 here.')
export const messageImages = (images: z.infer<typeof MessageImagesSchema> | undefined) =>
  images?.map(image => ({ imageKey: image.image_key, ...(image.alt ? { alt: image.alt } : {}) }))
