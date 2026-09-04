/**
 * Shrinking a photo before it's uploaded.
 *
 * A phone camera produces 4-to-8 MB files, and a gallery of twelve of those is a project page
 * nobody on campus wifi waits for. The club has no image pipeline and shouldn't grow one — every
 * upload is buffered through the API process — so the cheapest place to fix this is before the
 * bytes ever leave: decode, draw smaller, re-encode.
 *
 * Every function here is total. Canvas missing, `toBlob` missing, an undecodable source, a format
 * that can't be re-encoded safely — all end with the original file going up unchanged, where
 * `bodyLimit` and `MAX_IMAGE_FILE_MB` are the hard backstop. That's also why this is testable in
 * jsdom, which has no canvas at all.
 */

/**
 * The longest edge an uploaded picture is fitted inside.
 *
 * The gallery frame is drawn at most ~46rem wide, so 1920 covers it on a 2×
 * display with room to spare. Past that the extra pixels are bytes nobody's
 * screen can show.
 */
export const MAX_EDGE = 1920

/** Where the artefacts start being visible at this size, roughly. */
export const QUALITY = 0.82

/**
 * Below this, leave it alone. Re-encoding an already-small file routinely makes
 * it *bigger* — a 200 KB screenshot re-encoded to JPEG usually comes back
 * larger and worse.
 */
export const SKIP_BELOW_BYTES = 300 * 1024

/** What the file picker should offer, matching what the server's sniff accepts. */
export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp'

/**
 * How long to wait for a decode before giving up and uploading the original.
 *
 * A `try`/`catch` can't catch a hang, and the `<img>` fallback below can genuinely produce one: an
 * environment where neither `onload` nor `onerror` ever fires leaves that promise pending for the
 * life of the page, and the upload button waits with it. Everything else degrades to "send the
 * original"; without this, that one path degrades to nothing happening at all.
 */
const DECODE_TIMEOUT_MS = 4_000

/**
 * Target dimensions for a source, never upscaling.
 *
 * The pure half, split out because it is the part with arithmetic in it and the
 * part jsdom can run.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge || longest === 0) {
    return { width, height }
  }

  const scale = maxEdge / longest
  return {
    // At least 1: a 4000×3 panorama would otherwise round its short edge to
    // zero, and a zero-height canvas throws.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Whether this browser can *encode* WebP, by asking it to.
 *
 * A feature test rather than a UA check, and specifically this feature test: a
 * browser that cannot encode WebP does not throw, it silently hands back a PNG
 * data URL. Checking the returned mime type is the only honest question.
 */
function canEncodeWebp(): boolean {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    return canvas.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

/** `canvas.toBlob` as a promise, resolving to null rather than throwing. */
const toBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })

/**
 * Decode a file to something drawable.
 *
 * `imageOrientation: 'from-image'` is the EXIF answer — without it a portrait photo off a phone
 * decodes to its sensor orientation and lands on its side, which is the single most common
 * complaint about home-made image uploads. The `<img>` fallback relies on the browser's default
 * `image-orientation: from-image`, which current engines honour.
 */
async function decode(file: File): Promise<CanvasImageSource & {
  width: number
  height: number
}> {
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image()
      const timer = setTimeout(() => {
        reject(new Error('image decode timed out'))
      }, DECODE_TIMEOUT_MS)

      image.onload = () => {
        clearTimeout(timer)
        resolve(image)
      }
      image.onerror = () => {
        clearTimeout(timer)
        reject(new Error('image could not be decoded'))
      }
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * A picture, made smaller if that is both possible and worth doing.
 *
 * `downscaled` is for the form's status line — a lead who watched a 6 MB photo
 * become 240 KB should be told, and one whose file went up untouched should not
 * be told something that did not happen.
 */
export async function downscaleImage(
  file: File,
): Promise<{ file: File; downscaled: boolean }> {
  const untouched = { file, downscaled: false }

  try {
    // Small already, and in a format browsers render. Nothing to win.
    if (
      file.size < SKIP_BELOW_BYTES &&
      /^image\/(png|jpeg|webp|gif)$/.test(file.type)
    ) {
      return untouched
    }

    // Animation would be flattened to its first frame, which is a worse outcome
    // than a large file and an invisible one until somebody notices the GIF
    // stopped moving.
    if (file.type === 'image/gif') return untouched

    const source = await decode(file)
    const target = fitWithin(source.width, source.height)

    const webp = canEncodeWebp()

    // Nothing to resize, and re-encoding a PNG or an already-compressed JPEG at
    // its own size is how a file grows.
    if (
      target.width === source.width &&
      target.height === source.height &&
      (file.type === 'image/jpeg' || file.type === 'image/webp')
    ) {
      return untouched
    }

    // A transparent PNG flattened to JPEG comes back on a black square, and
    // somebody's logo on a black square is a worse bug than a big file. With no
    // WebP to fall back to, the PNG goes up as it is.
    if (!webp && file.type === 'image/png') return untouched

    const type = webp ? 'image/webp' : 'image/jpeg'

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height

    const context = canvas.getContext('2d')
    if (!context) return untouched
    context.drawImage(source, 0, 0, target.width, target.height)

    const blob = await toBlob(canvas, type, QUALITY)

    // Bigger than what we started with — which happens with small or already
    // well-compressed sources — so the work is thrown away rather than shipped.
    if (!blob || blob.size >= file.size) return untouched

    // `storeFile` takes `file.name` for `originalName` and `file.type` for the
    // Content-Type header it serves back, so an extension that disagrees with
    // the bytes ends up served wrong.
    const renamed = file.name.replace(/\.[^./\\]+$/, '')
    const extension = type === 'image/webp' ? 'webp' : 'jpg'

    return {
      file: new File([blob], `${renamed || 'image'}.${extension}`, { type }),
      downscaled: true,
    }
  } catch {
    return untouched
  }
}
