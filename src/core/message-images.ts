/** References to message images uploaded by the configured Feishu bot, never local paths or base64. */
export interface MessageImage { imageKey: string; alt?: string }
export function checkedImages(images: readonly MessageImage[] | undefined): MessageImage[] {
  if (!images?.length) return []
  if (images.length > 6) throw new Error('A reply supports at most 6 images')
  for (const image of images) {
    if (!/^img_[A-Za-z0-9_-]+$/.test(image.imageKey)) throw new Error('An image must have an uploaded Feishu image_key')
    if (image.alt !== undefined && (typeof image.alt !== 'string' || image.alt.length > 200)) throw new Error('Image captions must be at most 200 characters')
  }
  return images.map(image => ({ imageKey: image.imageKey, ...(image.alt ? { alt: image.alt } : {}) }))
}
