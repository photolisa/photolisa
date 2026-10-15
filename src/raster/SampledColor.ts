export interface SampledColor { r: number; g: number; b: number; a: number }

export function colorAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): SampledColor {
  const offset = (y * width + x) * 4
  return { r: pixels[offset] ?? 0, g: pixels[offset + 1] ?? 0, b: pixels[offset + 2] ?? 0, a: pixels[offset + 3] ?? 0 }
}

export function colorHex(color: SampledColor): string {
  return `#${[color.r, color.g, color.b, color.a].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export function colorRgbHex(color: SampledColor): string {
  return colorHex(color).slice(0, 7)
}

export function colorRgba(color: SampledColor): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${(color.a / 255).toFixed(3)})`
}
