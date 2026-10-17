import { clamp, luma, mapPixels, noise, rgb } from './EffectPixels'
import type { ExtendedEffectKind } from './EffectCatalog'
import type { PixelBuffer } from './types'
export function colorEffect(kind: ExtendedEffectKind, input: PixelBuffer, p: Record<string, number>): PixelBuffer {
  const v = (key: string) => p[key] ?? 0
  return mapPixels(input, (r, g, b, x, y) => {
    const l = luma(r, g, b) / 255, a = v('amount')
    switch (kind) {
      case 'gamma': return [r, g, b].map(c => Math.pow(c / 255, 1 / v('gamma')) * 255)
      case 'tone-range': { const d = (v('shadows') * (1 - l) ** 3 + v('highlights') * l ** 3) * 128; return [r + d, g + d, b + d] }
      case 'whites-blacks': { const d = (v('whites') * l ** 6 + v('blacks') * (1 - l) ** 6) * 128; return [r + d, g + d, b + d] }
      case 'tint': return [r + a * 20, g - a * 30, b + a * 20]
      case 'vibrance': { const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255; const k = 1 + a * (1 - saturation); return [l * 255 + (r - l * 255) * k, l * 255 + (g - l * 255) * k, l * 255 + (b - l * 255) * k] }
      case 'color-balance': return [r + v('red') * 64, g + v('green') * 64, b + v('blue') * 64]
      case 'posterize': { const steps = v('levels') - 1; return [r, g, b].map(c => Math.round(c / 255 * steps) / steps * 255) }
      case 'vintage': return [r * (1 - a * 0.12) + 30 * a, g * (1 - a * 0.2) + 20 * a, b * (1 - a * 0.35) + 18 * a]
      case 'duotone': case 'gradient-map': {
        const dark = rgb(v('dark')), light = rgb(v('light')), mid = rgb(v('mid'))
        return dark.map((c, i) => kind === 'duotone' ? c + ((light[i] ?? 0) - c) * l : l < 0.5 ? c + ((mid[i] ?? 0) - c) * l * 2 : (mid[i] ?? 0) + ((light[i] ?? 0) - (mid[i] ?? 0)) * (l - 0.5) * 2)
      }
      case 'threshold': return Array<number>(3).fill(l * 255 >= v('level') ? 255 : 0)
      case 'solarize': return [r, g, b].map(c => c >= v('level') ? 255 - c : c)
      case 'selective-color': {
        const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
        const hue = delta === 0 ? 0 : ((max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta) * 60 + 360) % 360
        const distance = Math.abs(((hue - v('hue') + 540) % 360) - 180)
        const weight = clamp(1 - distance / v('range')) * delta / Math.max(1, max)
        return [r - (v('cyan') + v('black')) * 128 * weight, g - (v('magenta') + v('black')) * 128 * weight, b - (v('yellow') + v('black')) * 128 * weight]
      }
      case 'vignette': {
        const dx = (x / Math.max(1, input.width - 1) - v('centerX')) * 2 / v('roundness'), dy = (y / Math.max(1, input.height - 1) - v('centerY')) * 2
        const t = clamp((Math.hypot(dx, dy) - (1 - v('feather'))) / v('feather')), fade = t * t * (3 - 2 * t) * a
        return [r, g, b].map(c => fade >= 0 ? c * (1 - fade) : c + (255 - c) * -fade)
      }
      case 'noise': case 'film-grain': {
        const size = kind === 'film-grain' ? v('size') : 1, nx = Math.floor(x / size), ny = Math.floor(y / size)
        const gaussian = (seed: number) => Math.sqrt(-2 * Math.log(Math.max(1e-8, noise(nx, ny, seed)))) * Math.cos(2 * Math.PI * noise(nx, ny, seed + 1))
        return [r, g, b].map((c, i) => c + gaussian(v('seed') + (kind === 'noise' && v('colored') ? i * 17 : 0)) * a * 64 * (kind === 'film-grain' ? 0.3 + Math.sqrt(l * (1 - l)) : 1))
      }
      case 'film-fade': return [r, g, b].map(c => c * (1 - a * 0.35) + a * 38)
      case 'light-leaks': { const glow = Math.exp(-((x / input.width - v('position')) ** 2 * 12 + (y / input.height - 0.35) ** 2 * 2)) * a; return [r, g, b].map((c, i) => 255 - (255 - c) * (1 - (rgb(v('color'))[i] ?? 0) / 255 * glow)) }
      case 'lens-flare': {
        const dx = x / input.width - v('centerX'), dy = (y / input.height - v('centerY')) * input.height / input.width
        const distance = Math.hypot(dx, dy), radius = v('radius')
        const core = Math.exp(-(distance ** 2) / (radius * radius * 0.05))
        const halo = Math.exp(-(((distance - radius) / (radius * 0.12)) ** 2)) * 0.25
        const streak = Math.exp(-Math.abs(dy) / 0.003) * Math.exp(-Math.abs(dx) / (radius * 3)) * 0.3
        return [r, g, b].map((c, i) => 255 - (255 - c) * Math.exp(-(core + halo + streak) * a * (i === 2 ? 1.3 : 1)))
      }
      default: throw new Error(`No point processor for ${kind}`)
    }
  })
}
