import type { RasterSource } from './RasterSourceRegistry'

/** Masks use opaque grayscale pixels; alpha is also honored for imported masks. */
export function maskAlphaCanvas(source: RasterSource, inverted: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D canvas is unavailable for a layer mask')
  context.drawImage(source.image, 0, 0)
  const pixels = context.getImageData(0, 0, source.width, source.height)
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.round(((pixels.data[i] ?? 0) + (pixels.data[i + 1] ?? 0) + (pixels.data[i + 2] ?? 0)) / 3)
    const coverage = Math.round(gray * (pixels.data[i + 3] ?? 0) / 255)
    pixels.data[i] = 255; pixels.data[i + 1] = 255; pixels.data[i + 2] = 255
    pixels.data[i + 3] = inverted ? 255 - coverage : coverage
  }
  context.putImageData(pixels, 0, 0)
  return canvas
}
