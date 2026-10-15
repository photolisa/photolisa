export interface ColorValue { r: number; g: number; b: number; a: number }
export interface ColorSwatch { id: string; name: string; color: ColorValue }
export interface SwatchCollection { id: string; name: string; colors: ColorSwatch[] }
export interface ColorSnapshot {
  version: 1
  foreground: ColorValue
  background: ColorValue
  history: ColorValue[]
  favorites: ColorSwatch[]
  collections: SwatchCollection[]
}
export interface ColorStorage { load(): Promise<ColorSnapshot | null>; save(snapshot: ColorSnapshot): Promise<void> }

const BLACK: ColorValue = { r: 0, g: 0, b: 0, a: 255 }
const WHITE: ColorValue = { r: 255, g: 255, b: 255, a: 255 }
const HISTORY_LIMIT = 24
const COLLECTION_LIMIT = 32
const SWATCH_LIMIT = 128

export class ColorManager {
  private state: ColorSnapshot = { version: 1, foreground: { ...BLACK }, background: { ...WHITE }, history: [], favorites: [], collections: [] }
  private readonly listeners = new Set<(snapshot: ColorSnapshot) => void>()
  private generation = 0
  private pendingSave: Promise<void> = Promise.resolve()
  private loaded = false
  persistenceError: string | null = null

  constructor(private readonly storage?: ColorStorage) {}
  get snapshot(): ColorSnapshot { return structuredClone(this.state) }
  subscribe(listener: (snapshot: ColorSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  async load(): Promise<void> {
    if (this.loaded) return
    const generation = this.generation
    const stored = await this.storage?.load()
    this.loaded = true
    if (!stored) return
    const saved = validateSnapshot(stored)
    if (generation === this.generation) { this.state = saved; this.emit(); return }
    // An edit made before hydration wins, while previously saved swatches survive.
    const current = this.state
    const history = [...current.history, ...saved.history]
    this.state = {
      ...current,
      history: history.filter((color, index) => history.findIndex((entry) => formatHex(entry) === formatHex(color)) === index).slice(0, HISTORY_LIMIT),
      favorites: [...saved.favorites.filter((item) => !current.favorites.some((newItem) => newItem.id === item.id)), ...current.favorites],
      collections: [...saved.collections.filter((item) => !current.collections.some((newItem) => newItem.id === item.id)), ...current.collections],
    }
    this.changed()
  }

  async flush(): Promise<void> { await this.pendingSave }
  setForeground(color: ColorValue): void { this.state.foreground = normalizeColor(color); this.remember(this.state.foreground); this.changed() }
  setBackground(color: ColorValue): void { this.state.background = normalizeColor(color); this.remember(this.state.background); this.changed() }
  swap(): void { [this.state.foreground, this.state.background] = [this.state.background, this.state.foreground]; this.changed() }
  reset(): void { this.state.foreground = { ...BLACK }; this.state.background = { ...WHITE }; this.changed() }
  addFavorite(color: ColorValue, name = ''): string {
    if (this.state.favorites.length >= SWATCH_LIMIT) throw new Error('Favorite swatch limit reached')
    const normalized = normalizeColor(color)
    const id = createId()
    this.state.favorites.push({ id, name: validName(name || formatHex(normalized)), color: normalized })
    this.changed(); return id
  }
  removeFavorite(id: string): void { this.state.favorites = this.state.favorites.filter((swatch) => swatch.id !== id); this.changed() }
  renameFavorite(id: string, name: string): void { const swatch = this.requireFavorite(id); swatch.name = validName(name); this.changed() }
  createCollection(name: string): string {
    if (this.state.collections.length >= COLLECTION_LIMIT) throw new Error('Swatch collection limit reached')
    const id = createId()
    this.state.collections.push({ id, name: validName(name), colors: [] }); this.changed(); return id
  }
  renameCollection(id: string, name: string): void { this.requireCollection(id).name = validName(name); this.changed() }
  removeCollection(id: string): void { this.state.collections = this.state.collections.filter((collection) => collection.id !== id); this.changed() }
  addColor(collectionId: string, color: ColorValue, name = ''): string {
    const collection = this.requireCollection(collectionId)
    if (collection.colors.length >= SWATCH_LIMIT) throw new Error('Swatch collection is full')
    const normalized = normalizeColor(color)
    const id = createId()
    collection.colors.push({ id, name: validName(name || formatHex(normalized)), color: normalized })
    this.changed(); return id
  }
  renameColor(collectionId: string, swatchId: string, name: string): void { this.requireSwatch(collectionId, swatchId).name = validName(name); this.changed() }
  removeColor(collectionId: string, swatchId: string): void {
    const collection = this.requireCollection(collectionId)
    collection.colors = collection.colors.filter((swatch) => swatch.id !== swatchId)
    this.changed()
  }

  private remember(color: ColorValue): void {
    const key = formatHex(color)
    this.state.history = [{ ...color }, ...this.state.history.filter((entry) => formatHex(entry) !== key)].slice(0, HISTORY_LIMIT)
  }
  private changed(): void {
    this.generation += 1
    this.emit()
    if (this.storage) {
      const snapshot = this.snapshot
      this.pendingSave = this.pendingSave.catch(() => undefined).then(() => this.storage!.save(snapshot)).then(() => { if (this.persistenceError) { this.persistenceError = null; this.emit() } }, (error: unknown) => { this.persistenceError = error instanceof Error ? error.message : 'Color swatches could not be saved locally'; this.emit() })
    }
  }
  private emit(): void { const snapshot = this.snapshot; this.listeners.forEach((listener) => listener(snapshot)) }
  private requireCollection(id: string): SwatchCollection {
    const collection = this.state.collections.find((item) => item.id === id)
    if (!collection) throw new Error('Swatch collection not found')
    return collection
  }
  private requireFavorite(id: string): ColorSwatch {
    const swatch = this.state.favorites.find((item) => item.id === id)
    if (!swatch) throw new Error('Favorite swatch not found')
    return swatch
  }
  private requireSwatch(collectionId: string, swatchId: string): ColorSwatch {
    const swatch = this.requireCollection(collectionId).colors.find((item) => item.id === swatchId)
    if (!swatch) throw new Error('Swatch not found')
    return swatch
  }
}

export function normalizeColor(color: ColorValue): ColorValue {
  const channels = [color.r, color.g, color.b, color.a]
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) throw new Error('Color channels must be between 0 and 255')
  return { r: Math.round(color.r), g: Math.round(color.g), b: Math.round(color.b), a: Math.round(color.a) }
}
export function formatHex(color: ColorValue, includeAlpha = true): string {
  const channels = includeAlpha ? [color.r, color.g, color.b, color.a] : [color.r, color.g, color.b]
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}
export function parseHex(input: string): ColorValue {
  const value = input.trim().replace(/^#/, '')
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) throw new Error('Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA')
  const expanded = value.length <= 4 ? [...value].map((digit) => digit + digit).join('') : value
  return { r: parseInt(expanded.slice(0, 2), 16), g: parseInt(expanded.slice(2, 4), 16), b: parseInt(expanded.slice(4, 6), 16), a: expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) : 255 }
}
export function fromHsl(hue: number, saturation: number, lightness: number, alpha = 255): ColorValue {
  if (![hue, saturation, lightness, alpha].every(Number.isFinite) || saturation < 0 || saturation > 100 || lightness < 0 || lightness > 100) throw new Error('Invalid HSL color')
  const h = ((hue % 360) + 360) % 360 / 60, s = saturation / 100, l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const secondary = chroma * (1 - Math.abs(h % 2 - 1))
  const pair = h < 1 ? [chroma, secondary, 0] : h < 2 ? [secondary, chroma, 0] : h < 3 ? [0, chroma, secondary] : h < 4 ? [0, secondary, chroma] : h < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary]
  const offset = l - chroma / 2
  return normalizeColor({ r: (pair[0]! + offset) * 255, g: (pair[1]! + offset) * 255, b: (pair[2]! + offset) * 255, a: alpha })
}
export function toHsl(color: ColorValue): { h: number; s: number; l: number } {
  const r = color.r / 255, g = color.g / 255, b = color.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let h = 0
  if (delta) { if (max === r) h = ((g - b) / delta) % 6; else if (max === g) h = (b - r) / delta + 2; else h = (r - g) / delta + 4 }
  h = ((h * 60) + 360) % 360
  const l = (max + min) / 2
  const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}
function validName(name: string): string { const value = name.trim(); if (!value || value.length > 80) throw new Error('Swatch name must contain 1–80 characters'); return value }
function createId(): string { return globalThis.crypto?.randomUUID?.() ?? `swatch-${Date.now()}-${Math.random()}` }
function validateSnapshot(value: ColorSnapshot): ColorSnapshot {
  if (value?.version !== 1 || !Array.isArray(value.history) || !Array.isArray(value.favorites) || !Array.isArray(value.collections)) throw new Error('Unsupported color library')
  if (value.history.length > HISTORY_LIMIT || value.favorites.length > SWATCH_LIMIT || value.collections.length > COLLECTION_LIMIT) throw new Error('Color library exceeds limits')
  const collections = value.collections.map((collection) => ({ id: validName(collection.id), name: validName(collection.name), colors: validateSwatches(collection.colors) }))
  return { version: 1, foreground: normalizeColor(value.foreground), background: normalizeColor(value.background), history: value.history.map(normalizeColor), favorites: validateSwatches(value.favorites), collections }
}
function validateSwatches(swatches: ColorSwatch[]): ColorSwatch[] {
  if (!Array.isArray(swatches) || swatches.length > SWATCH_LIMIT) throw new Error('Invalid swatches')
  return swatches.map((swatch) => ({ id: validName(swatch.id), name: validName(swatch.name), color: normalizeColor(swatch.color) }))
}

export const BASIC_PALETTES = {
  Grayscale: ['#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#FFFFFF'].map(parseHex),
  Common: ['#FF0000', '#FF8000', '#FFFF00', '#00AA00', '#00BFFF', '#0000FF', '#8000FF', '#FF00AA', '#8B4513', '#FFFFFF', '#000000', '#00000000'].map(parseHex),
} as const
