import type { PixelBuffer } from './types'
export const clamp = (v: number, min = 0, max = 1): number => Math.max(min, Math.min(max, v))
export const copy = (p: PixelBuffer): PixelBuffer => ({ ...p, data: new Uint8ClampedArray(p.data) })
export const luma = (r: number, g: number, b: number): number => r * 0.2126 + g * 0.7152 + b * 0.0722
export const rgb = (color: number): number[] => [(color >> 16) & 255, (color >> 8) & 255, color & 255]
export function noise(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ Math.imul(y, 374761393) ^ Math.imul(seed, 668265263), 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
export function sample(p: PixelBuffer, x: number, y: number, channel: number): number {
  const i = (Math.max(0, Math.min(p.height - 1, Math.round(y))) * p.width + Math.max(0, Math.min(p.width - 1, Math.round(x)))) * 4
  return channel < 3 && !p.data[i + 3] ? 0 : p.data[i + channel] ?? 0
}
/** Bilinear interpolation in premultiplied alpha prevents hidden RGB from bleeding. */
export function bilinear(p: PixelBuffer, x: number, y: number, output: Uint8ClampedArray, offset: number): void {
  x = clamp(x, 0, p.width - 1); y = clamp(y, 0, p.height - 1)
  const left = Math.floor(x), top = Math.floor(y), fx = x - left, fy = y - top
  let alpha = 0
  const sums = [0, 0, 0]
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy)
    const index = (Math.min(p.height - 1, top + dy) * p.width + Math.min(p.width - 1, left + dx)) * 4
    const a = (p.data[index + 3] ?? 0) * weight
    alpha += a
    for (let c = 0; c < 3; c++) sums[c] = (sums[c] ?? 0) + (p.data[index + c] ?? 0) * a
  }
  for (let c = 0; c < 3; c++) output[offset + c] = alpha > 0 ? (sums[c] ?? 0) / alpha : 0
  output[offset + 3] = alpha
}
export function mapPixels(p: PixelBuffer, transform: (r: number, g: number, b: number, x: number, y: number) => number[]): PixelBuffer {
  const out = copy(p)
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) { out.data.fill(0, i, i + 4); continue }
    const v = transform(p.data[i] ?? 0, p.data[i + 1] ?? 0, p.data[i + 2] ?? 0, (i / 4) % p.width, Math.floor(i / 4 / p.width))
    for (let c = 0; c < 3; c++) out.data[i + c] = v[c] ?? 0
  }
  return out
}
/** Linear-time sliding window blur, including alpha. */
export function boxBlur(p: PixelBuffer, radius: number): PixelBuffer {
  const r = Math.round(radius)
  if (r <= 0) return copy(p)
  const span = r * 2 + 1, result = copy(p), rows = new Map<number, Float32Array>()
  function row(y: number): Float32Array {
    y = clamp(y, 0, p.height - 1)
    const existing = rows.get(y); if (existing) return existing
    const values = new Float32Array(p.width * 4), sums = [0, 0, 0, 0]
    const value = (x: number, c: number) => { const i = (y * p.width + clamp(x, 0, p.width - 1)) * 4; return c === 3 ? p.data[i + 3] ?? 0 : (p.data[i + c] ?? 0) * (p.data[i + 3] ?? 0) / 255 }
    for (let x = -r; x <= r; x++) for (let c = 0; c < 4; c++) sums[c] = (sums[c] ?? 0) + value(x, c)
    for (let x = 0; x < p.width; x++) {
      for (let c = 0; c < 4; c++) { values[x * 4 + c] = (sums[c] ?? 0) / span; sums[c] = (sums[c] ?? 0) + value(x + r + 1, c) - value(x - r, c) }
    }
    rows.set(y, values); return values
  }
  const sums = new Float64Array(p.width * 4)
  for (let y = -r; y <= r; y++) { const values = row(y); for (let i = 0; i < sums.length; i++) sums[i] = (sums[i] ?? 0) + (values[i] ?? 0) }
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const alpha = (sums[x * 4 + 3] ?? 0) / span, i = (y * p.width + x) * 4
      for (let c = 0; c < 3; c++) result.data[i + c] = alpha > 0 ? (sums[x * 4 + c] ?? 0) / span * 255 / alpha : 0
      result.data[i + 3] = alpha
    }
    const add = row(y + r + 1), remove = row(y - r)
    for (let i = 0; i < sums.length; i++) sums[i] = (sums[i] ?? 0) + (add[i] ?? 0) - (remove[i] ?? 0)
    rows.delete(y - r)
  }
  return result
}
export function edges(p: PixelBuffer, x: number, y: number): number {
  let gx = 0, gy = 0
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const l = luma(sample(p, x + dx, y + dy, 0), sample(p, x + dx, y + dy, 1), sample(p, x + dx, y + dy, 2))
    gx += l * dx * (dy === 0 ? 2 : 1); gy += l * dy * (dx === 0 ? 2 : 1)
  }
  return Math.hypot(gx, gy) / 4
}
/** Separable convolution with only a rolling halo of float rows, not a full float image. */
export function convolve(input: PixelBuffer, kernel: Float32Array): PixelBuffer {
  const radius = Math.floor(kernel.length / 2), rows = new Map<number, Float32Array>(), output = copy(input)
  function row(y: number): Float32Array {
    y = clamp(y, 0, input.height - 1)
    const existing = rows.get(y); if (existing) return existing
    const values = new Float32Array(input.width * 4)
    for (let x = 0; x < input.width; x++) for (let dx = -radius; dx <= radius; dx++) {
      const index = (y * input.width + clamp(x + dx, 0, input.width - 1)) * 4, weight = kernel[dx + radius] ?? 0, alpha = input.data[index + 3] ?? 0
      for (let c = 0; c < 3; c++) values[x * 4 + c] = (values[x * 4 + c] ?? 0) + (input.data[index + c] ?? 0) * alpha / 255 * weight
      values[x * 4 + 3] = (values[x * 4 + 3] ?? 0) + alpha * weight
    }
    rows.set(y, values); return values
  }
  for (let y = 0; y < input.height; y++) {
    const halo = Array.from({ length: kernel.length }, (_, j) => row(y + j - radius))
    for (let x = 0; x < input.width; x++) {
      const sums = [0, 0, 0, 0]
      for (let j = 0; j < kernel.length; j++) for (let c = 0; c < 4; c++) sums[c] = (sums[c] ?? 0) + (halo[j]?.[x * 4 + c] ?? 0) * (kernel[j] ?? 0)
      const alpha = sums[3] ?? 0, i = (y * input.width + x) * 4
      for (let c = 0; c < 3; c++) output.data[i + c] = alpha > 0 ? (sums[c] ?? 0) * 255 / alpha : 0
      output.data[i + 3] = alpha
    }
    rows.delete(y - radius)
  }
  return output
}
