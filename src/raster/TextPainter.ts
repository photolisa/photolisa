import type { TextLayer } from '../core/model/types'

function fontCss(layer: TextLayer): string {
  const family = layer.fontFamily.replace(/["\\\r\n]/g, '').slice(0, 120) || 'sans-serif'
  return `${layer.fontStyle} ${layer.fontWeight} ${layer.fontSize}px "${family}", sans-serif`
}

export async function loadTextFont(layer: TextLayer): Promise<void> {
  if (typeof document.fonts?.load === 'function') {
    try { await document.fonts.load(fontCss(layer), layer.text.slice(0, 100)) } catch { /* Browser fallback remains usable. */ }
  }
}

export function textPixelSize(layer: TextLayer): { width: number; height: number; padding: number; lineHeight: number } {
  const measuring = document.createElement('canvas').getContext('2d')
  if (!measuring) throw new Error('2D canvas is unavailable for text')
  measuring.font = fontCss(layer)
  const lines = textLines(layer, measuring)
  const padding = Math.ceil(layer.fontSize * 0.25) + 2
  const lineHeight = layer.fontSize * layer.lineSpacing
  const width = layer.textBox ? Math.ceil(layer.textBox.width) : Math.max(1, Math.ceil(Math.max(0, ...lines.map((line) => measuring.measureText(line).width)) + padding * 2))
  const height = layer.textBox ? Math.ceil(layer.textBox.height) : Math.max(1, Math.ceil(lines.length * lineHeight + padding * 2))
  if (width > 16_384 || height > 16_384 || width * height > 67_108_864) throw new Error('Text layer exceeds the pixel safety limit')
  return { width, height, padding, lineHeight }
}

/** The same Canvas2D pixels feed Pixi preview and raster exports. */
export function paintTextLayer(layer: TextLayer): HTMLCanvasElement {
  const { width, height, padding, lineHeight } = textPixelSize(layer)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable for text')
  context.font = fontCss(layer)
  const lines = textLines(layer, context)
  context.textBaseline = 'top'
  context.textAlign = layer.alignment
  context.fillStyle = layer.color
  const x = layer.alignment === 'left' ? padding : layer.alignment === 'center' ? width / 2 : width - padding
  lines.forEach((line, index) => context.fillText(line, x, padding + index * lineHeight))
  return canvas
}

/** Wrap at word boundaries and split long words without changing the stored text. */
function textLines(layer: TextLayer, context: CanvasRenderingContext2D): string[] {
  if (!layer.textBox) return layer.text.split('\n')
  const padding = Math.ceil(layer.fontSize * .25) + 2
  const available = Math.max(1, layer.textBox.width - padding * 2), result: string[] = []
  for (const paragraph of layer.text.split('\n')) {
    let line = ''
    for (const token of paragraph.match(/\S+\s*|\s+/g) ?? ['']) {
      if (line && context.measureText(line + token).width > available) { result.push(line.trimEnd()); line = '' }
      for (const char of token) {
        if (line && context.measureText(line + char).width > available) { result.push(line.trimEnd()); line = '' }
        line += char
      }
    }
    result.push(line.trimEnd())
  }
  return result
}
