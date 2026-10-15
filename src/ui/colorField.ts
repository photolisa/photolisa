import type { ColorValue } from '../core/colors/ColorManager'

export interface HsvColor { h: number; s: number; v: number }
export function toHsv(color: ColorValue): HsvColor {
  const r = color.r / 255, g = color.g / 255, b = color.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  const hue = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return { h: (hue * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max }
}
export function fromHsv({ h, s, v }: HsvColor, alpha: number): ColorValue {
  const hue = ((h % 360) + 360) % 360 / 60
  const c = v * s, x = c * (1 - Math.abs(hue % 2 - 1)), m = v - c
  const [r, g, b] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
  return { r: Math.round((r! + m) * 255), g: Math.round((g! + m) * 255), b: Math.round((b! + m) * 255), a: alpha }
}
