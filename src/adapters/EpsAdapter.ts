import type { EditorDocument } from '../core/model/EditorDocument'
import { validateFileSize, validateRasterBudget } from './FileSafety'
import { ImageExportAdapter } from './ImageExportAdapter'

export interface EpsImportResult {
  name: string
  width: number
  height: number
  bitmap: ImageBitmap
  warnings: string[]
}

const MAX_EPS_PIXELS = 16_000_000
const HEX = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, '0').toUpperCase())

/** EPS is executable PostScript. This adapter decodes only passive pixel data, never operators. */
export class EpsAdapter {
  async import(file: File): Promise<EpsImportResult> {
    validateFileSize(file, 'EPS')
    if (file.size > 128 * 1024 * 1024) throw new Error('EPS import is limited to 128 MiB of source data.')
    const input = await file.text()
    if (!/^%!PS-Adobe-[^\r\n]*EPSF-/i.test(input)) throw new Error('This is not an EPS file.')
    const own = /^%%PhotolisaRGB:\s*(\d+)\s+(\d+)\s*$/m.exec(input)
    const decoded = own ? decodePhotolisaPixels(input, own) : decodeEpsiPreview(input)
    const canvas = document.createElement('canvas')
    canvas.width = decoded.width; canvas.height = decoded.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable for EPS import.')
    context.putImageData(decoded.image, 0, 0)
    const bitmap = await createImageBitmap(canvas)
    return {
      name: file.name.replace(/\.(?:eps|epsf|epsi)$/i, '') || 'Imported EPS',
      width: decoded.width, height: decoded.height, bitmap,
      warnings: decoded.preview
        ? ['EPS imported from its embedded screen preview. PostScript artwork was not interpreted; the preview may be lower resolution or grayscale.']
        : ['EPS imported as one raster layer. Editable PostScript paths and layers are not preserved.'],
    }
  }

  async export(document: EditorDocument, renderer: ImageExportAdapter): Promise<{ blob: Blob; warnings: string[] }> {
    const { width, height, resolution } = document.dimensions
    validateEpsPixels(width, height)
    const surface = await renderer.renderDocument(document)
    const pointsX = width * 72 / resolution
    const pointsY = height * 72 / resolution
    if (!Number.isFinite(pointsX) || !Number.isFinite(pointsY) || pointsX <= 0 || pointsY <= 0)
      throw new Error('EPS requires a valid document resolution.')
    const parts: BlobPart[] = [
      `%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Photolisa\n%%BoundingBox: 0 0 ${Math.ceil(pointsX)} ${Math.ceil(pointsY)}\n%%HiResBoundingBox: 0 0 ${pointsX} ${pointsY}\n%%PhotolisaRGB: ${width} ${height}\n%%LanguageLevel: 2\n%%EndComments\n`,
      'gsave\n',
      `${pointsX} ${pointsY} scale\n${width} ${height} 8 [${width} 0 0 -${height} 0 ${height}]\n`,
      'currentfile /ASCIIHexDecode filter false 3 colorimage\n',
    ]
    const context = surface.canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas is unavailable for EPS export.')
    for (let y = 0; y < height; y++) {
      const row = context.getImageData(0, y, width, 1).data
      const hex: string[] = new Array(width * 3)
      for (let x = 0; x < width; x++) {
        const offset = x * 4
        const alpha = row[offset + 3] ?? 0
        for (let channel = 0; channel < 3; channel++) {
          const color = row[offset + channel] ?? 0
          hex[x * 3 + channel] = HEX[Math.round((color * alpha + 255 * (255 - alpha)) / 255)] ?? 'FF'
        }
      }
      parts.push(hex.join(''), '\n')
    }
    parts.push('>\ngrestore\n%%EOF\n')
    return {
      blob: new Blob(parts, { type: 'application/postscript' }),
      warnings: ['EPS export is a full-resolution flattened RGB image. Layers, editable text and vectors are not preserved; transparency is composited onto white.'],
    }
  }
}

function validateEpsPixels(width: number, height: number): void {
  validateRasterBudget(width, height, 'EPS')
  if (width * height > MAX_EPS_PIXELS) throw new Error('EPS is limited to 16 megapixels because its uncompressed RGB data would exceed the export memory budget. Use PDF or PNG for this document.')
}

function decodePhotolisaPixels(input: string, marker: RegExpExecArray): { width: number; height: number; image: ImageData; preview: false } {
  const width = Number(marker[1]); const height = Number(marker[2])
  validateEpsPixels(width, height)
  const command = 'currentfile /ASCIIHexDecode filter false 3 colorimage'
  const commandAt = input.indexOf(command, marker.index + marker[0].length)
  if (commandAt < 0) throw new Error('The Photolisa EPS pixel stream is missing.')
  let position = commandAt + command.length
  const image = new ImageData(width, height)
  const bytes = width * height * 3
  for (let index = 0; index < bytes; index++) {
    while (/\s/.test(input[position] ?? '')) position++
    const pair = input.slice(position, position + 2)
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) throw new Error('The EPS pixel stream is incomplete or invalid.')
    const value = parseInt(pair, 16)
    const pixel = Math.floor(index / 3) * 4
    image.data[pixel + index % 3] = value
    if (index % 3 === 2) image.data[pixel + 3] = 255
    position += 2
  }
  while (/\s/.test(input[position] ?? '')) position++
  if (input[position] !== '>') throw new Error('The EPS pixel stream has unexpected extra data.')
  return { width, height, image, preview: false }
}

function decodeEpsiPreview(input: string): { width: number; height: number; image: ImageData; preview: true } {
  const match = /^%%BeginPreview:\s*(\d+)\s+(\d+)\s+([1248])\s+(\d+)\s*$/m.exec(input)
  if (!match) throw new Error('This EPS has no supported embedded preview. Arbitrary PostScript cannot be opened safely in the browser; convert it to PDF or PNG first.')
  const width = Number(match[1]); const height = Number(match[2])
  const depth = Number(match[3]); const lineCount = Number(match[4])
  validateEpsPixels(width, height)
  if (!Number.isSafeInteger(lineCount) || lineCount < 1 || lineCount > height * 32) throw new Error('Invalid EPS preview line count.')
  const end = input.indexOf('%%EndPreview', match.index + match[0].length)
  if (end < 0) throw new Error('The EPS preview is incomplete.')
  const lines = input.slice(match.index + match[0].length, end).trim().split(/\r\n|\n\r|\r|\n/)
  if (lines.length !== lineCount) throw new Error('The EPS preview line count is incorrect.')
  const hex = lines.map(line => {
    if (!/^%\s*[0-9a-fA-F\s]*$/.test(line)) throw new Error('Invalid EPS preview data.')
    return line.slice(1).replace(/\s/g, '')
  }).join('')
  const rowBytes = Math.ceil(width * depth / 8)
  if (hex.length !== rowBytes * height * 2) throw new Error('The EPS preview dimensions do not match its pixel data.')
  const image = new ImageData(width, height)
  const maximum = (1 << depth) - 1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const bit = x * depth
    const byte = parseInt(hex.slice((y * rowBytes + Math.floor(bit / 8)) * 2, (y * rowBytes + Math.floor(bit / 8)) * 2 + 2), 16)
    const sample = (byte >> (8 - depth - bit % 8)) & maximum
    const gray = Math.round(255 * (1 - sample / maximum))
    const offset = (y * width + x) * 4
    image.data[offset] = gray; image.data[offset + 1] = gray; image.data[offset + 2] = gray; image.data[offset + 3] = 255
  }
  return { width, height, image, preview: true }
}
