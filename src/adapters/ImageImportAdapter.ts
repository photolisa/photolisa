const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_DIMENSION = 16_384
const MAX_PIXELS = 100_000_000
const HEADER_BYTES = 1024 * 1024

export type SupportedImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ImageMetadata {
  mime: SupportedImageMime
  width: number
  height: number
}

export interface DecodedImage extends ImageMetadata {
  name: string
  bitmap: ImageBitmap
}

export class ImageImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageImportError'
  }
}

export class ImageImportAdapter {
  async decode(file: File): Promise<DecodedImage> {
    if (file.size === 0) throw new ImageImportError('The selected file is empty.')
    if (file.size > MAX_FILE_BYTES) throw new ImageImportError('Image files must be 100 MB or smaller.')

    const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
    const metadata = inspectImageHeader(header)
    validateDimensions(metadata.width, metadata.height)

    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file, { premultiplyAlpha: 'default', colorSpaceConversion: 'default' })
    } catch {
      throw new ImageImportError('The image could not be decoded. It may be damaged or unsupported.')
    }

    if (bitmap.width !== metadata.width || bitmap.height !== metadata.height) {
      bitmap.close()
      throw new ImageImportError('The decoded image dimensions do not match its file header.')
    }

    return { ...metadata, name: stripExtension(file.name) || 'Imported image', bitmap }
  }
}

export function inspectImageHeader(bytes: Uint8Array): ImageMetadata {
  if (isPng(bytes)) return readPng(bytes)
  if (isJpeg(bytes)) return readJpeg(bytes)
  if (isWebP(bytes)) return readWebP(bytes)
  throw new ImageImportError('Choose a PNG, JPEG, or WebP image.')
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return signature.every((byte, index) => bytes[index] === byte)
}

function readPng(bytes: Uint8Array): ImageMetadata {
  if (bytes.length < 24) throw new ImageImportError('The PNG header is incomplete.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) }
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8
}

function readJpeg(bytes: Uint8Array): ImageMetadata {
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]
    if (marker === undefined) break
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
    if (length < 2 || offset + length + 2 > bytes.length) break
    if (isStartOfFrame(marker)) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0)
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0)
      return { mime: 'image/jpeg', width, height }
    }
    offset += length + 2
  }
  throw new ImageImportError('The JPEG dimensions could not be read safely.')
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
}

function isWebP(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
}

function readWebP(bytes: Uint8Array): ImageMetadata {
  if (bytes.length < 30) throw new ImageImportError('The WebP header is incomplete.')
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X') {
    return {
      mime: 'image/webp',
      width: 1 + readUint24LE(bytes, 24),
      height: 1 + readUint24LE(bytes, 27),
    }
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) throw new ImageImportError('The WebP lossless header is invalid.')
    const bits = (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24)
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      throw new ImageImportError('The WebP lossy header is invalid.')
    }
    return {
      mime: 'image/webp',
      width: ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff,
      height: ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff,
    }
  }
  throw new ImageImportError('The WebP encoding is not supported.')
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new ImageImportError('The image has invalid dimensions.')
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new ImageImportError('The image is too large. Maximum size is 16,384 px per side and 100 megapixels.')
  }
}

function stripExtension(name: string): string {
  return name.replace(/\.(png|jpe?g|webp)$/i, '')
}
