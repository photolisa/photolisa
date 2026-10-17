import { clamp, copy } from './EffectPixels'
import type { ColorLookupTable, EffectSelection, LayerAdjustment, PixelBuffer } from './types'
export const EFFECT_BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const

export function normalizeSelection(selection: EffectSelection): EffectSelection {
  if (!selection || ![selection.x, selection.y, selection.width, selection.height].every(Number.isSafeInteger) || selection.x < 0 || selection.y < 0 || selection.width < 1 || selection.height < 1 || selection.width * selection.height > 16_777_216 || !Array.isArray(selection.runs) || selection.runs.length > 2_000_000 || selection.runs.length % 2) throw new Error('Invalid or oversized effect selection')
  let count = 0
  for (let i = 0; i < selection.runs.length; i += 2) {
    const value = selection.runs[i], length = selection.runs[i + 1]
    if (value === undefined || length === undefined || !Number.isInteger(value) || value < 0 || value > 255 || !Number.isSafeInteger(length) || length < 1) throw new Error('Invalid effect selection coverage')
    count += length
  }
  if (count !== selection.width * selection.height) throw new Error('Effect selection length does not match its dimensions')
  return { ...selection, runs: [...selection.runs] }
}
export function normalizeLut(lut: ColorLookupTable): ColorLookupTable {
  if (!lut || !Number.isInteger(lut.size) || lut.size < 2 || lut.size > 33 || !Array.isArray(lut.data) || lut.data.length !== lut.size ** 3 * 3 || lut.data.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Invalid LUT: use a 2–33 point RGB cube with values between 0 and 1')
  return { size: lut.size, data: [...lut.data] }
}
export function parseCube(text: string): ColorLookupTable {
  if (text.length > 4_000_000) throw new Error('LUT file exceeds 4 MB')
  let size = 0; const data: number[] = []
  for (const source of text.split(/\r?\n/)) {
    const line = source.replace(/#.*/, '').trim()
    if (!line || line.startsWith('TITLE')) continue
    const parts = line.split(/\s+/), key = parts[0]
    if (key === 'LUT_3D_SIZE') { size = Number(parts[1]); continue }
    if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      const expected = key === 'DOMAIN_MIN' ? 0 : 1
      if (parts.length !== 4 || parts.slice(1).some(v => Number(v) !== expected)) throw new Error('Only LUT domains from 0 to 1 are supported')
      continue
    }
    if (parts.length !== 3 || parts.some(v => !Number.isFinite(Number(v)))) throw new Error('Unsupported .cube LUT data; select a 3D RGB cube')
    data.push(...parts.map(Number))
  }
  return normalizeLut({ size, data })
}
export function defaultLut(): ColorLookupTable {
  const size = 2, data: number[] = []
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) data.push(clamp(r * 0.95 + 0.04), clamp(g * 0.93 + 0.02), clamp(b * 0.85 + 0.04))
  return { size, data }
}
export function applyLut(input: PixelBuffer, lut: ColorLookupTable, amount: number): PixelBuffer {
  const out = copy(input), max = lut.size - 1
  for (let i = 0; i < input.data.length; i += 4) {
    const point = [0, 1, 2].map(c => (input.data[i + c] ?? 0) / 255 * max), base = point.map(Math.floor), frac = point.map((v, c) => v - (base[c] ?? 0))
    for (let c = 0; c < 3; c++) {
      let result = 0
      for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        const index = ((Math.min(max, (base[2] ?? 0) + z) * lut.size + Math.min(max, (base[1] ?? 0) + y)) * lut.size + Math.min(max, (base[0] ?? 0) + x)) * 3 + c
        result += (lut.data[index] ?? 0) * (x ? frac[0] ?? 0 : 1 - (frac[0] ?? 0)) * (y ? frac[1] ?? 0 : 1 - (frac[1] ?? 0)) * (z ? frac[2] ?? 0 : 1 - (frac[2] ?? 0))
      }
      out.data[i + c] = (input.data[i + c] ?? 0) * (1 - amount) + result * 255 * amount
    }
  }
  return out
}
/** Blend a processed stage with its input; masks are immutable local-space coverage. */
export function compositeEffect(input: PixelBuffer, processed: PixelBuffer, effect: LayerAdjustment): PixelBuffer {
  const opacity = effect.opacity ?? 1, mode = effect.blendMode ?? 'normal', selection = effect.selection
  if (opacity === 1 && mode === 'normal' && !selection) return processed
  const output = copy(input)
  let mask: Uint8Array | null = null
  if (selection) {
    mask = new Uint8Array(selection.width * selection.height)
    let cursor = 0
    for (let i = 0; i < selection.runs.length; i += 2) { const count = selection.runs[i + 1] ?? 0; mask.fill(selection.runs[i] ?? 0, cursor, cursor + count); cursor += count }
  }
  for (let i = 0; i < input.data.length; i += 4) {
    const x = i / 4 % input.width, y = Math.floor(i / 4 / input.width)
    const coverage = selection && mask ? x >= selection.x && x < selection.x + selection.width && y >= selection.y && y < selection.y + selection.height ? (mask[(y - selection.y) * selection.width + x - selection.x] ?? 0) / 255 : 0 : 1
    const weight = opacity * coverage, a = (input.data[i + 3] ?? 0) / 255, b = (processed.data[i + 3] ?? 0) / 255
    const alpha = a * (1 - weight) + b * weight
    for (let c = 0; c < 3; c++) {
      const base = (input.data[i + c] ?? 0) / 255, top = (processed.data[i + c] ?? 0) / 255
      const blend = mode === 'multiply' ? base * top : mode === 'screen' ? 1 - (1 - base) * (1 - top) : mode === 'overlay' ? base <= 0.5 ? 2 * base * top : 1 - 2 * (1 - base) * (1 - top) : mode === 'soft-light' ? (1 - 2 * top) * base * base + 2 * top * base : top
      output.data[i + c] = alpha > 0 ? (base * a * (1 - weight) + blend * b * weight) / alpha * 255 : 0
    }
    output.data[i + 3] = alpha * 255
  }
  return output
}
