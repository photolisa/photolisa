import type { EditorDocument } from '../core/model/EditorDocument'
import { ImageExportAdapter } from './ImageExportAdapter'

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const
export type IcoSize = typeof ICO_SIZES[number]
export type IcoEncoding = 'png' | 'bmp'
export interface IcoEntry { index: number; width: number; height: number; bitDepth: number; encoding: IcoEncoding }
interface IcoRecord extends IcoEntry { offset: number; length: number }
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_ENTRIES = 128
const MAX_DECODED_PIXELS = 8_000_000
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export class IcoError extends Error { constructor(message: string) { super(message); this.name = 'IcoError' } }

function isPng(bytes: Uint8Array, offset: number): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[offset + index] === value)
}

/** Reject malformed directories and unsafe allocations before asking a decoder to read image data. */
function inspectRecords(bytes: Uint8Array): IcoRecord[] {
  if (bytes.length < 6 || bytes.length > MAX_FILE_BYTES) throw new IcoError('ICO files must be between 6 bytes and 32 MB.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) throw new IcoError('This is not a Windows ICO file.')
  const count = view.getUint16(4, true)
  if (count < 1 || count > MAX_ENTRIES || bytes.length < 6 + count * 16) throw new IcoError('The ICO image directory is invalid or too large.')
  const records: IcoRecord[] = []
  let pixels = 0
  for (let index = 0; index < count; index++) {
    const base = 6 + index * 16
    const width = bytes[base] || 256
    const height = bytes[base + 1] || 256
    const bitDepth = view.getUint16(base + 6, true)
    const length = view.getUint32(base + 8, true)
    const offset = view.getUint32(base + 12, true)
    if (length < 33 || offset < 6 + count * 16 || offset > bytes.length || length > bytes.length - offset) throw new IcoError(`ICO image ${index + 1} has invalid bounds.`)
    pixels += width * height
    if (pixels > MAX_DECODED_PIXELS) throw new IcoError('The ICO contains too many decoded pixels.')
    const encoding: IcoEncoding = isPng(bytes, offset) ? 'png' : 'bmp'
    if (encoding === 'png') {
      if (length < 33 || view.getUint32(offset + 8) !== 13 || String.fromCharCode(...bytes.subarray(offset + 12, offset + 16)) !== 'IHDR') throw new IcoError(`ICO image ${index + 1} has an invalid PNG header.`)
      if (view.getUint32(offset + 16) !== width || view.getUint32(offset + 20) !== height) throw new IcoError(`ICO image ${index + 1} has mismatched PNG dimensions.`)
    } else {
      if (length < 40) throw new IcoError(`ICO image ${index + 1} has an incomplete BMP header.`)
      const dibSize = view.getUint32(offset, true)
      const dibWidth = view.getInt32(offset + 4, true)
      const dibHeight = view.getInt32(offset + 8, true)
      const planes = view.getUint16(offset + 12, true)
      const compression = view.getUint32(offset + 16, true)
      const depth = view.getUint16(offset + 14, true)
      if (dibSize < 40 || dibSize > length || dibWidth !== width || Math.abs(dibHeight) !== height * 2 || planes !== 1 || compression !== 0 || ![1, 4, 8, 24, 32].includes(depth)) {
        throw new IcoError(`ICO image ${index + 1} uses an unsupported or invalid BMP encoding.`)
      }
    }
    records.push({ index, width, height, bitDepth, encoding, offset, length })
  }
  return records
}

export function inspectIco(bytes: Uint8Array): IcoEntry[] {
  return inspectRecords(bytes).map(({ index, width, height, bitDepth, encoding }) => ({ index, width, height, bitDepth, encoding }))
}

function selectedIco(bytes: Uint8Array, record: IcoRecord): ArrayBuffer {
  const result = new Uint8Array(22 + record.length)
  result.set(bytes.subarray(0, 6))
  result[4] = 1; result[5] = 0
  result.set(bytes.subarray(6 + record.index * 16, 22 + record.index * 16), 6)
  new DataView(result.buffer).setUint32(18, 22, true)
  result.set(bytes.subarray(record.offset, record.offset + record.length), 22)
  return result.buffer
}

export class IcoAdapter {
  async inspect(file: File): Promise<IcoEntry[]> {
    if (file.size > MAX_FILE_BYTES) throw new IcoError('ICO files must be 32 MB or smaller.')
    return inspectIco(new Uint8Array(await file.arrayBuffer()))
  }

  async decode(file: File, index: number): Promise<{ bitmap: ImageBitmap; width: number; height: number; name: string }> {
    if (file.size > MAX_FILE_BYTES) throw new IcoError('ICO files must be 32 MB or smaller.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const record = inspectRecords(bytes)[index]
    if (!record) throw new IcoError('Choose a resolution from this ICO file.')
    try {
      let png: Blob
      if (record.encoding === 'png') png = new Blob([bytes.slice(record.offset, record.offset + record.length)], { type: 'image/png' })
      else {
        // The decoder sees only one validated entry, not every image in an untrusted ICO.
        const { parse } = await import('icojs/browser')
        const [decoded] = await parse(selectedIco(bytes, record))
        if (!decoded || decoded.width !== record.width || decoded.height !== record.height) throw new Error('Unexpected decoded dimensions')
        png = new Blob([decoded.buffer], { type: 'image/png' })
      }
      const bitmap = await createImageBitmap(png)
      if (bitmap.width !== record.width || bitmap.height !== record.height) { bitmap.close(); throw new Error('Unexpected decoded dimensions') }
      return { bitmap, width: record.width, height: record.height, name: file.name.replace(/\.ico$/i, '') || 'Imported icon' }
    } catch { throw new IcoError(`The ${record.width}×${record.height} ICO image could not be decoded.`) }
  }

  async export(document: EditorDocument, sizes: readonly IcoSize[], providedExporter?: ImageExportAdapter): Promise<Blob> {
    const unique = [...new Set(sizes)]
    if (!unique.length || unique.some((size) => !ICO_SIZES.includes(size))) throw new IcoError('Select at least one supported icon size.')
    if (document.dimensions.width * document.dimensions.height > 64_000_000) throw new IcoError('ICO export is limited to source documents of 64 megapixels to protect browser memory.')
    const exporter = providedExporter ?? new ImageExportAdapter()
    try {
      const surface = await exporter.renderDocument(document)
      const entries: { size: number; png: Uint8Array }[] = []
      for (const size of unique) {
        const icon = downsampleIcon(surface.canvas, size)
        const blob = await new Promise<Blob>((resolve, reject) => icon.toBlob((value) => value ? resolve(value) : reject(new IcoError('PNG encoding failed.')), 'image/png'))
        entries.push({ size, png: new Uint8Array(await blob.arrayBuffer()) })
      }
      return new Blob([encodeIco(entries)], { type: 'image/x-icon' })
    } finally { if (!providedExporter) exporter.destroy() }
  }
}

/** ICO container writer. Each payload is a real PNG, never a renamed PNG file. */
export function encodeIco(entries: readonly { size: number; png: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  if (!entries.length || entries.length > ICO_SIZES.length) throw new IcoError('Select one to seven icon sizes.')
  if (new Set(entries.map((entry) => entry.size)).size !== entries.length) throw new IcoError('Icon sizes must be unique.')
  const total = 6 + entries.length * 16 + entries.reduce((sum, entry) => sum + entry.png.length, 0)
  if (total > MAX_FILE_BYTES) throw new IcoError('The encoded ICO exceeds 32 MB.')
  const result = new Uint8Array(total)
  const view = new DataView(result.buffer)
  view.setUint16(2, 1, true); view.setUint16(4, entries.length, true)
  let offset = 6 + entries.length * 16
  entries.forEach(({ size, png }, index) => {
    if (!ICO_SIZES.includes(size as IcoSize) || png.length < 33 || !isPng(png, 0)) throw new IcoError('ICO export requires valid PNG images at supported sizes.')
    const pngView = new DataView(png.buffer, png.byteOffset, png.byteLength)
    if (pngView.getUint32(16) !== size || pngView.getUint32(20) !== size) throw new IcoError('PNG image dimensions do not match their ICO entry.')
    const base = 6 + index * 16
    result[base] = size === 256 ? 0 : size; result[base + 1] = size === 256 ? 0 : size
    view.setUint16(base + 4, 1, true); view.setUint16(base + 6, 32, true)
    view.setUint32(base + 8, png.length, true); view.setUint32(base + 12, offset, true)
    result.set(png, offset); offset += png.length
  })
  return result
}

function downsampleIcon(source: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const ratio = Math.min(size / source.width, size / source.height)
  const targetWidth = Math.max(1, Math.round(source.width * ratio))
  const targetHeight = Math.max(1, Math.round(source.height * ratio))
  let current: HTMLCanvasElement = source
  // Multiple 2× reductions avoid the poor quality of a single large browser rescale.
  while (current.width > targetWidth * 2 || current.height > targetHeight * 2) {
    const next = document.createElement('canvas')
    next.width = Math.max(targetWidth, Math.ceil(current.width / 2))
    next.height = Math.max(targetHeight, Math.ceil(current.height / 2))
    const context = next.getContext('2d')
    if (!context) throw new IcoError('2D canvas is unavailable for icon export.')
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    context.drawImage(current, 0, 0, next.width, next.height)
    current = next
  }
  const output = document.createElement('canvas')
  output.width = size; output.height = size
  const context = output.getContext('2d')
  if (!context) throw new IcoError('2D canvas is unavailable for icon export.')
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
  context.drawImage(current, Math.floor((size - targetWidth) / 2), Math.floor((size - targetHeight) / 2), targetWidth, targetHeight)
  return output
}
