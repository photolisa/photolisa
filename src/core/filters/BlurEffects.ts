import { bilinear, boxBlur, clamp, copy, luma, mapPixels, sample } from './EffectPixels'
import type { ExtendedEffectKind } from './EffectCatalog'
import type { PixelBuffer } from './types'
export function blurEffect(kind: ExtendedEffectKind, input: PixelBuffer, p: Record<string, number>, gaussian: (p: PixelBuffer, radius: number) => PixelBuffer): PixelBuffer {
  const v = (key: string) => p[key] ?? 0
  const out = copy(input)
  if (kind === 'box-blur') return boxBlur(input, v('radius'))
  if (kind === 'surface-blur') {
    const radius = Math.round(v('radius')), threshold = v('threshold')
    return mapPixels(input, (r, g, b, x, y) => {
      const sum = [0, 0, 0]; let total = 0
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const sr = sample(input, x + dx, y + dy, 0), sg = sample(input, x + dx, y + dy, 1), sb = sample(input, x + dx, y + dy, 2)
        const diff = Math.max(Math.abs(sr - r), Math.abs(sg - g), Math.abs(sb - b))
        const weight = Math.exp(-diff * diff / (2 * threshold * threshold)) * sample(input, x + dx, y + dy, 3) / 255
        total += weight; sum[0] = (sum[0] ?? 0) + sr * weight; sum[1] = (sum[1] ?? 0) + sg * weight; sum[2] = (sum[2] ?? 0) + sb * weight
      }
      return total ? sum.map(c => c / total) : [r, g, b]
    })
  }
  if (['unsharp-mask', 'clarity', 'glow', 'soft-focus', 'tilt-shift'].includes(kind)) {
    if (kind === 'clarity') {
      const broad = gaussian(input, 20), fine = gaussian(input, 2)
      return mapPixels(input, (r, g, b, x, y) => {
        const i = (y * input.width + x) * 4, lum = luma(r, g, b) / 255, midtones = 4 * lum * (1 - lum)
        return [r, g, b].map((c, k) => c + (c - (broad.data[i + k] ?? c)) * v('clarity') * midtones + (c - (fine.data[i + k] ?? c)) * v('texture'))
      })
    }
    let source = input
    if (kind === 'glow') source = mapPixels(input, (r, g, b) => { const weight = clamp((luma(r, g, b) / 255 - v('threshold')) / Math.max(0.001, 1 - v('threshold'))); return [r * weight, g * weight, b * weight] })
    const blurred = gaussian(source, v('radius'))
    return mapPixels(input, (r, g, b, x, y) => {
      const i = (y * input.width + x) * 4
      let amount = v('amount')
      if (kind === 'tilt-shift') {
        const angle = v('angle') * Math.PI / 180
        const distance = Math.abs((y / input.height - v('position')) * Math.cos(angle) + (x / input.width - 0.5) * Math.sin(angle))
        amount = clamp((distance - v('width') / 2) / 0.2)
      }
      return [r, g, b].map((c, k) => {
        const b = blurred.data[i + k] ?? c
        if (kind === 'unsharp-mask') return Math.abs(c - b) >= v('threshold') ? c + (c - b) * amount : c
        if (kind === 'glow') return 255 - (255 - c) * (1 - clamp(b / 255 * amount))
        return c + (b - c) * amount
      })
    })
  }
  const temp = new Uint8ClampedArray(4)
  const steps = kind === 'lens-blur' ? 48 : 32
  const angle = v('angle') * Math.PI / 180
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    const sums = [0, 0, 0]; let alpha = 0
    for (let j = 0; j < steps; j++) {
      const t = j / (steps - 1) - 0.5
      let sx = x, sy = y
      if (kind === 'motion-blur') { sx += Math.cos(angle) * v('distance') * t; sy += Math.sin(angle) * v('distance') * t }
      else if (kind === 'lens-blur') {
        const theta = j * 2.399963229728653, blades = v('blades'), half = Math.PI / blades
        const boundary = Math.cos(half) / Math.cos(((theta % (2 * half)) + 2 * half) % (2 * half) - half)
        const r = Math.sqrt((j + 0.5) / steps) * v('radius') * boundary
        sx += Math.cos(theta) * r; sy += Math.sin(theta) * r
      } else {
        const dx = x - input.width * v('centerX'), dy = y - input.height * v('centerY')
        if (kind === 'radial-blur') { const spin = t * angle; sx = input.width * v('centerX') + dx * Math.cos(spin) - dy * Math.sin(spin); sy = input.height * v('centerY') + dx * Math.sin(spin) + dy * Math.cos(spin) }
        else if (kind === 'zoom-blur') { sx = x + dx * t * v('amount'); sy = y + dy * t * v('amount') }
        else throw new Error(`No blur processor for ${kind}`)
      }
      bilinear(input, sx, sy, temp, 0)
      const a = temp[3] ?? 0; alpha += a
      for (let c = 0; c < 3; c++) sums[c] = (sums[c] ?? 0) + (temp[c] ?? 0) * a
    }
    const i = (y * input.width + x) * 4
    for (let c = 0; c < 3; c++) out.data[i + c] = alpha ? (sums[c] ?? 0) / alpha : 0
    out.data[i + 3] = alpha / steps
  }
  return out
}
