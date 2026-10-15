import type { DocumentDimensions } from '../../core/model/types'

export const PDF_LIMITS = {
  fileBytes: 100 * 1024 * 1024,
  pages: 100,
  side: 8192,
  pixels: 16_777_216,
  batchPixels: 67_108_864,
} as const
export function checkDpi(dpi: number): void {
  if (!Number.isFinite(dpi) || dpi < 1 || dpi > 1200)
    throw new Error('PDF resolution must be between 1 and 1200 DPI.')
}
export function checkPixels(width: number, height: number): void {
  if (
    ![width, height].every(
      (n) => Number.isFinite(n) && n > 0 && n <= PDF_LIMITS.side,
    ) ||
    width * height > PDF_LIMITS.pixels
  )
    throw new Error(
      'PDF rendering exceeds the limit of 8192 pixels per side or 16 megapixels per page. Choose a lower DPI.',
    )
}
export function checkPdfFile(bytes: Uint8Array): void {
  if (bytes.length > PDF_LIMITS.fileBytes)
    throw new Error('PDF files must be at most 100 MB.')
  if (
    !new TextDecoder('ascii').decode(bytes.subarray(0, 5)).startsWith('%PDF-')
  )
    throw new Error('The file does not have a valid PDF signature.')
}
export function selectedPages(input: string, count: number): number[] {
  const result = new Set<number>()
  for (const part of input.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!match) throw new Error('Enter pages such as 1, 3-5.')
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1])
    if (start < 1 || end > count || start > end)
      throw new Error(`Pages must be between 1 and ${count}.`)
    for (let page = start; page <= end; page++) result.add(page)
  }
  return [...result].sort((a, b) => a - b)
}
export interface PdfExportOptions {
  pageSize: 'original' | 'a4' | 'a3' | 'letter' | 'custom'
  orientation: 'portrait' | 'landscape'
  customWidth: number // millimetres
  customHeight: number
  dpi: number
  margin: number // millimetres
  fit: 'contain' | 'cover' | 'actual'
  background: 'transparent' | 'white' | 'custom'
  color: string
  encoding: 'png' | 'jpeg'
  quality: number
  mode: 'flattened' | 'vector'
}
export const defaultPdfOptions = (): PdfExportOptions => ({
  pageSize: 'original',
  orientation: 'portrait',
  customWidth: 210,
  customHeight: 297,
  dpi: 150,
  margin: 0,
  fit: 'contain',
  background: 'white',
  color: '#ffffff',
  encoding: 'png',
  quality: 0.92,
  mode: 'flattened',
})
export function pdfLayout(
  dimensions: DocumentDimensions,
  options: PdfExportOptions,
) {
  checkDpi(options.dpi)
  if (!Number.isFinite(dimensions.resolution) || dimensions.resolution <= 0)
    throw new Error('Invalid document resolution.')
  const mm = 72 / 25.4
  const original = {
    width: (dimensions.width * 72) / dimensions.resolution,
    height: (dimensions.height * 72) / dimensions.resolution,
  }
  const sizes = {
    a4: [210, 297],
    a3: [297, 420],
    letter: [215.9, 279.4],
    custom: [options.customWidth, options.customHeight],
  }
  let width = original.width,
    height = original.height
  if (options.pageSize !== 'original') {
    const size = sizes[options.pageSize]
    width = size[0]! * mm
    height = size[1]! * mm
    if (options.orientation === 'landscape')
      [width, height] = [Math.max(width, height), Math.min(width, height)]
    else [width, height] = [Math.min(width, height), Math.max(width, height)]
  }
  if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 14_400))
    throw new Error(
      'PDF page dimensions must be positive and at most 200 inches.',
    )
  const margin = options.margin * mm
  if (
    !Number.isFinite(margin) ||
    margin < 0 ||
    margin * 2 >= Math.min(width, height)
  )
    throw new Error('Margins must leave a positive page area.')
  if (
    !Number.isFinite(options.quality) ||
    options.quality < 0 ||
    options.quality > 1
  )
    throw new Error('Invalid JPEG quality.')
  if (!/^#[0-9a-f]{6}$/i.test(options.color))
    throw new Error('Choose a six-digit background color.')
  const availableWidth = width - margin * 2,
    availableHeight = height - margin * 2
  const ratio =
    options.fit === 'actual'
      ? 1
      : Math[options.fit === 'cover' ? 'max' : 'min'](
          availableWidth / original.width,
          availableHeight / original.height,
        )
  const imageWidth = original.width * ratio,
    imageHeight = original.height * ratio
  const pixelWidth = Math.ceil((width * options.dpi) / 72),
    pixelHeight = Math.ceil((height * options.dpi) / 72)
  checkPixels(pixelWidth, pixelHeight)
  return {
    width,
    height,
    margin,
    imageWidth,
    imageHeight,
    x: (width - imageWidth) / 2,
    y: (height - imageHeight) / 2,
    pixelWidth,
    pixelHeight,
    scale: imageWidth / dimensions.width,
  }
}
export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('PDF operation cancelled.', 'AbortError')
}
export const yieldPdf = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))
