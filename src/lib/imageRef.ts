// Shared (client + server) helpers for describing how an image is sourced and displayed.
//
// Image-bearing string columns (WebSponsor.imageUrl, Member.profilePictureUrl,
// SiteContent.value) historically stored a bare URL/path. To support per-image
// display adjustments without a schema migration, those columns may now ALSO hold a
// compact JSON envelope. Legacy plain strings keep working unchanged because they
// parse to the default adjustments.

export type Fit = 'cover' | 'contain' | 'fill';

export interface ImageRef {
  /** Where the image is loaded from: external URL, /uploads/<key>, or /photos/... path. */
  src: string;
  /** Uploaded filename in UPLOAD_DIR when this image is a local upload; else undefined. */
  upload?: string;
  fit: Fit;
  /** object-position X, 0..100 */
  focalX: number;
  /** object-position Y, 0..100 */
  focalY: number;
  /** transform scale multiplier */
  scale: number;
}

export const DEFAULT_ADJUSTMENTS: Omit<ImageRef, 'src' | 'upload'> = {
  fit: 'cover',
  focalX: 50,
  focalY: 50,
  scale: 1
};

const KEY_RE = /^[a-f0-9-]{36}\.[a-z0-9]{2,5}$/i;
const UPLOAD_PATH_RE = /\/uploads\/([a-f0-9-]{36}\.[a-z0-9]{2,5})/i;

function clampPct(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(0, Math.round(v)));
}

function clampScale(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return 1;
  return Math.min(5, Math.max(0.1, v));
}

/** Parse a stored string (plain URL/path or JSON envelope) into a normalized ImageRef. */
export function parseImageRef(value: string | null | undefined): ImageRef {
  if (!value) return { src: '', ...DEFAULT_ADJUSTMENTS };
  if (value.startsWith('{')) {
    try {
      const o = JSON.parse(value) as Partial<ImageRef>;
      return {
        src: typeof o.src === 'string' ? o.src : '',
        upload: typeof o.upload === 'string' ? o.upload : undefined,
        fit: o.fit === 'contain' || o.fit === 'fill' ? o.fit : 'cover',
        focalX: clampPct(o.focalX, 50),
        focalY: clampPct(o.focalY, 50),
        scale: clampScale(o.scale)
      };
    } catch {
      // fall through to treat as a plain string
    }
  }
  return { src: value, ...DEFAULT_ADJUSTMENTS };
}

/**
 * Serialize an ImageRef back to a stored string. Emits a bare URL/path when there are
 * no adjustments and it's not an upload, keeping new values byte-compatible with the
 * old data format (and avoiding needless JSON churn).
 */
export function serializeImageRef(ref: ImageRef): string {
  const pristine =
    ref.fit === 'cover' &&
    ref.focalX === 50 &&
    ref.focalY === 50 &&
    ref.scale === 1 &&
    !ref.upload;
  if (pristine) return ref.src;
  const out: ImageRef = {
    src: ref.src,
    fit: ref.fit,
    focalX: ref.focalX,
    focalY: ref.focalY,
    scale: ref.scale
  };
  if (ref.upload) out.upload = ref.upload;
  return JSON.stringify(out);
}

/** Extract the upload storage key from any image-bearing string (plain or envelope). */
export function keyFromSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(UPLOAD_PATH_RE);
  return m ? m[1] : null;
}

export function isValidStorageKey(key: string): boolean {
  return KEY_RE.test(key);
}

/** Build the CSS for applying an ImageRef's display adjustments to an <img>. */
export function imageRefStyle(ref: ImageRef): string {
  return (
    `object-fit:${ref.fit};` +
    `object-position:${ref.focalX}% ${ref.focalY}%;` +
    `transform:scale(${ref.scale});` +
    `transform-origin:${ref.focalX}% ${ref.focalY}%;`
  );
}

/** A subset of the Prisma Picture model carrying source + adjustment fields. */
export interface PictureLike {
  data?: string | null;
  storageKey?: string | null;
  fit?: string | null;
  focalX?: number | null;
  focalY?: number | null;
  scale?: number | null;
}

/** Is a stored image value (plain string or envelope) an acceptable src to persist? */
export function isDisplayableImageValue(value: string | null | undefined): boolean {
  const { src } = parseImageRef(value);
  if (!src) return false;
  return src.startsWith('https://') || src.startsWith('/');
}

/** Prisma Picture column data derived from a stored image value (URL/path or envelope). */
export interface PictureFields {
  data: string;
  storageKey: string | null;
  fit: Fit;
  focalX: number;
  focalY: number;
  scale: number;
  isLocal: boolean;
}

export function pictureFieldsFromValue(value: string): PictureFields {
  const r = parseImageRef(value);
  const storageKey = r.upload ?? keyFromSrc(r.src);
  return {
    data: r.src,
    storageKey,
    fit: r.fit,
    focalX: r.focalX,
    focalY: r.focalY,
    scale: r.scale,
    isLocal: !!storageKey
  };
}

/** Adapt a Picture row to the stored-string form AdjustableImage understands. */
export function pictureToValue(picture: PictureLike | null | undefined): string {
  if (!picture) return '';
  const src = picture.storageKey ? `/uploads/${picture.storageKey}` : picture.data ?? '';
  const ref: ImageRef = {
    src,
    upload: picture.storageKey ?? undefined,
    fit: picture.fit === 'contain' || picture.fit === 'fill' ? picture.fit : 'cover',
    focalX: clampPct(picture.focalX, 50),
    focalY: clampPct(picture.focalY, 50),
    scale: clampScale(picture.scale)
  };
  return serializeImageRef(ref);
}
