import { boxBlur, clamp, copy, edges, luma, mapPixels, noise, sample } from './EffectPixels'
import { blurEffect } from './BlurEffects'
import type { ExtendedEffectKind } from './EffectCatalog'
import type { PixelBuffer } from './types'
export function artisticEffect(kind: ExtendedEffectKind, input: PixelBuffer, p: Record<string, number>, gaussian: (p: PixelBuffer, radius: number) => PixelBuffer): PixelBuffer {
  const v = (key: string) => p[key] ?? 0
  if (kind === 'pixelate') {
    const output = copy(input), size = Math.round(v('size'))
    for (let top = 0; top < input.height; top += size) for (let left = 0; left < input.width; left += size) {
      let alpha = 0; const sums = [0, 0, 0]
      for (let y = top; y < Math.min(top + size, input.height); y++) for (let x = left; x < Math.min(left + size, input.width); x++) {
        const i = (y * input.width + x) * 4, a = input.data[i + 3] ?? 0; alpha += a
        for (let c = 0; c < 3; c++) sums[c] = (sums[c] ?? 0) + (input.data[i + c] ?? 0) * a
      }
      for (let y = top; y < Math.min(top + size, input.height); y++) for (let x = left; x < Math.min(left + size, input.width); x++) for (let c = 0; c < 3; c++) output.data[(y * input.width + x) * 4 + c] = alpha ? (sums[c] ?? 0) / alpha : 0
    }
    return output
  }
  if (kind === 'oil-painting') {
    const bins = Math.round(v('levels')), radius = Math.round(v('radius'))
    const counts = new Float64Array(bins), sums = new Float64Array(bins * 3)
    return mapPixels(input, (r, g, b, x, y) => {
      counts.fill(0); sums.fill(0)
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue
        const sr = sample(input, x + dx, y + dy, 0), sg = sample(input, x + dx, y + dy, 1), sb = sample(input, x + dx, y + dy, 2), alpha = sample(input, x + dx, y + dy, 3) / 255
        const bin = Math.min(bins - 1, Math.floor(luma(sr, sg, sb) / 256 * bins))
        counts[bin] = (counts[bin] ?? 0) + alpha
        sums[bin * 3] = (sums[bin * 3] ?? 0) + sr * alpha; sums[bin * 3 + 1] = (sums[bin * 3 + 1] ?? 0) + sg * alpha; sums[bin * 3 + 2] = (sums[bin * 3 + 2] ?? 0) + sb * alpha
      }
      let best = 0
      for (let bin = 1; bin < bins; bin++) if ((counts[bin] ?? 0) > (counts[best] ?? 0)) best = bin
      const count = counts[best] ?? 0
      return count ? [0, 1, 2].map(c => (sums[best * 3 + c] ?? 0) / count) : [r, g, b]
    })
  }
  if (kind === 'pencil-sketch') {
    const gray = mapPixels(input, (r, g, b) => Array<number>(3).fill(luma(r, g, b)))
    const inverted = mapPixels(gray, r => Array<number>(3).fill(255 - r)), blurred = gaussian(inverted, v('radius'))
    return mapPixels(gray, (r, _g, _b, x, y) => {
      const dodge = Math.min(255, r * 255 / Math.max(1, 255 - (blurred.data[(y * input.width + x) * 4] ?? 0)))
      return Array<number>(3).fill((dodge - 128) * v('contrast') + 128)
    })
  }
  if (kind === 'watercolor') {
    const washed = blurEffect('surface-blur', input, { radius: v('radius'), threshold: 35 }, gaussian)
    return mapPixels(washed, (r, g, b, x, y) => [r, g, b].map(c => Math.round(c / 255 * (v('levels') - 1)) / (v('levels') - 1) * 255 - edges(input, x, y) * 0.25 + (noise(x, y, 31) - 0.5) * 4))
  }
  const smoothed = kind === 'cartoon' || kind === 'comic-book' ? boxBlur(input, 1) : input
  return mapPixels(smoothed, (r, g, b, x, y) => {
    if (kind === 'cartoon' || kind === 'comic-book') {
      const ink = clamp(1 - edges(input, x, y) / 255 * v('edges') * 2)
      const dot = kind === 'comic-book' && (x % v('size') - v('size') / 2) ** 2 + (y % v('size') - v('size') / 2) ** 2 < v('size') * 0.2 ? 0.72 : 1
      return [r, g, b].map(c => Math.round(c / 255 * (v('levels') - 1)) / (v('levels') - 1) * 255 * ink * dot)
    }
    if (kind === 'emboss') {
      const theta = v('angle') * Math.PI / 180, dx = Math.cos(theta), dy = Math.sin(theta)
      const light = luma(sample(input, x + dx, y + dy, 0), sample(input, x + dx, y + dy, 1), sample(input, x + dx, y + dy, 2))
      const dark = luma(sample(input, x - dx, y - dy, 0), sample(input, x - dx, y - dy, 1), sample(input, x - dx, y - dy, 2))
      return Array<number>(3).fill(128 + (light - dark) * v('amount'))
    }
    if (kind === 'halftone') {
      const theta = v('angle') * Math.PI / 180, size = v('size'), u = x * Math.cos(theta) - y * Math.sin(theta), w = x * Math.sin(theta) + y * Math.cos(theta)
      const cx = Math.round(u / size) * size, cy = Math.round(w / size) * size
      const sx = cx * Math.cos(theta) + cy * Math.sin(theta), sy = -cx * Math.sin(theta) + cy * Math.cos(theta)
      const brightness = luma(sample(input, sx, sy, 0), sample(input, sx, sy, 1), sample(input, sx, sy, 2)) / 255
      const radius = Math.sqrt((1 - brightness) / Math.PI) * size
      const coverage = clamp(radius - Math.hypot(u - cx, w - cy) + 0.5)
      return Array<number>(3).fill((1 - coverage) * 255)
    }
    if (kind === 'glitch') {
      const band = Math.floor(y / 8), shift = noise(band, 0, v('seed')) > 0.65 ? (noise(band, 1, v('seed')) - 0.5) * v('amount') * 2 : 0
      return [sample(input, x + shift + v('amount') * 0.15, y, 0), sample(input, x + shift, y, 1), sample(input, x + shift - v('amount') * 0.15, y, 2)]
    }
    throw new Error(`No artistic processor for ${kind}`)
  })
}
