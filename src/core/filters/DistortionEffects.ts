import { bilinear, clamp, copy } from './EffectPixels'
import type { ExtendedEffectKind } from './EffectCatalog'
import type { PixelBuffer } from './types'
export function distortionEffect(kind: ExtendedEffectKind, input: PixelBuffer, p: Record<string, number>): PixelBuffer {
  const v = (key: string) => p[key] ?? 0, output = copy(input), cx = v('centerX') * input.width, cy = v('centerY') * input.height
  const scale = Math.max(1, Math.min(input.width, input.height) / 2), temp = new Uint8ClampedArray(4)
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    const dx = (x - cx) / scale, dy = (y - cy) / scale, r = Math.hypot(dx, dy), i = (y * input.width + x) * 4
    let sx = x, sy = y
    switch (kind) {
      case 'liquify': { const falloff = clamp(1 - r / (v('radius') * 2)) ** 2; sx -= v('dx') * input.width * falloff; sy -= v('dy') * input.height * falloff; break }
      case 'wave': sx += Math.sin(y / v('length') * Math.PI * 2) * v('amount'); sy += Math.sin(x / v('length') * Math.PI * 2) * v('amount'); break
      case 'ripple': { const offset = Math.sin(r * scale / v('length') * Math.PI * 2) * v('amount'); if (r > 0) { sx += dx / r * offset; sy += dy / r * offset } break }
      case 'twirl': { const theta = v('angle') * Math.PI / 180 * clamp(1 - r) ** 2; sx = cx + (dx * Math.cos(theta) - dy * Math.sin(theta)) * scale; sy = cy + (dx * Math.sin(theta) + dy * Math.cos(theta)) * scale; break }
      case 'spherize': case 'pinch': {
        if (r > 0 && r < 1) {
          const target = kind === 'spherize' ? Math.asin(r) * 2 / Math.PI : r ** (1 + Math.abs(v('amount')) * 2)
          const amount = kind === 'pinch' ? Math.sign(v('amount')) : v('amount')
          const factor = (r + (target - r) * amount) / r
          sx = cx + dx * factor * scale; sy = cy + dy * factor * scale
        }
        break
      }
      case 'perspective-warp': {
        const nx = x / input.width - 0.5, ny = y / input.height - 0.5, denominator = 1 + v('horizontal') * nx + v('vertical') * ny
        sx = (nx / denominator + 0.5) * input.width; sy = (ny / denominator + 0.5) * input.height; break
      }
      case 'lens-distortion': { const factor = 1 + v('amount') * r * r; sx = cx + dx * factor * scale; sy = cy + dy * factor * scale; break }
      case 'chromatic-aberration': {
        const factor = v('amount') / Math.max(1, input.width)
        bilinear(input, x + (x - input.width / 2) * factor, y + (y - input.height / 2) * factor, temp, 0); output.data[i] = temp[0] ?? 0
        bilinear(input, x - (x - input.width / 2) * factor, y - (y - input.height / 2) * factor, temp, 0); output.data[i + 2] = temp[2] ?? 0
        continue
      }
      default: throw new Error(`No distortion processor for ${kind}`)
    }
    bilinear(input, sx, sy, output.data, i)
  }
  return output
}
