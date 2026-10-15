import { describe, expect, it } from 'vitest'
import { BASIC_PALETTES, ColorManager, formatHex, fromHsl, parseHex, toHsl, type ColorSnapshot, type ColorStorage } from '../../src/core/colors/ColorManager'

class MemoryColorStorage implements ColorStorage {
  saved: ColorSnapshot | null = null
  async load(): Promise<ColorSnapshot | null> { return this.saved ? structuredClone(this.saved) : null }
  async save(snapshot: ColorSnapshot): Promise<void> { this.saved = structuredClone(snapshot) }
}

describe('ColorManager', () => {
  it('parses HEX and converts RGB/HSL while preserving alpha', () => {
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 255 })
    expect(parseHex('#0f08')).toEqual({ r: 0, g: 255, b: 0, a: 136 })
    expect(formatHex(parseHex('#12345678'))).toBe('#12345678')
    expect(fromHsl(0, 100, 50, 128)).toEqual({ r: 255, g: 0, b: 0, a: 128 })
    expect(toHsl({ r: 255, g: 0, b: 0, a: 128 })).toEqual({ h: 0, s: 100, l: 50 })
    expect(() => parseHex('#xyz')).toThrow()
    expect(BASIC_PALETTES.Common.some((color) => color.a === 0)).toBe(true)
  })

  it('shares foreground and background, swaps, resets, and bounds history', () => {
    const manager = new ColorManager()
    manager.setForeground(parseHex('#12457880'))
    manager.setBackground(parseHex('#ABCDEF'))
    expect(manager.snapshot.history.map((color) => formatHex(color))).toEqual(['#ABCDEFFF', '#12457880'])
    manager.swap()
    expect(formatHex(manager.snapshot.foreground)).toBe('#ABCDEFFF')
    expect(formatHex(manager.snapshot.background)).toBe('#12457880')
    manager.reset()
    expect(formatHex(manager.snapshot.foreground)).toBe('#000000FF')
    expect(formatHex(manager.snapshot.background)).toBe('#FFFFFFFF')
    for (let i = 0; i < 30; i += 1) manager.setForeground({ r: i, g: 0, b: 0, a: 255 })
    expect(manager.snapshot.history).toHaveLength(24)
  })

  it('persists favorites and named collections with stable IDs', async () => {
    const storage = new MemoryColorStorage()
    const manager = new ColorManager(storage)
    manager.setForeground(parseHex('#11223344'))
    const favoriteId = manager.addFavorite(manager.snapshot.foreground, 'Glass')
    const collectionId = manager.createCollection('Brand')
    const swatchId = manager.addColor(collectionId, parseHex('#FF00FF'), 'Accent')
    manager.renameColor(collectionId, swatchId, 'Primary accent')
    manager.renameCollection(collectionId, 'Brand colors')
    await manager.flush()
    const reopened = new ColorManager(storage)
    await reopened.load()
    expect(reopened.snapshot.favorites[0]).toMatchObject({ id: favoriteId, name: 'Glass', color: parseHex('#11223344') })
    expect(reopened.snapshot.collections[0]).toMatchObject({ id: collectionId, name: 'Brand colors', colors: [{ id: swatchId, name: 'Primary accent' }] })
    reopened.removeColor(collectionId, swatchId)
    reopened.removeFavorite(favoriteId)
    reopened.removeCollection(collectionId)
    await reopened.flush()
    expect(storage.saved?.collections).toEqual([])
    expect(storage.saved?.favorites).toEqual([])
  })

  it('does not overwrite a foreground edit when loading completes late', async () => {
    const gate: { resolve?: (value: ColorSnapshot | null) => void } = {}
    const storage: ColorStorage = { load: () => new Promise((resolve) => { gate.resolve = resolve }), save: async () => undefined }
    const manager = new ColorManager(storage)
    const loading = manager.load()
    manager.setForeground(parseHex('#123456'))
    const stale = new ColorManager().snapshot
    stale.foreground = parseHex('#FF0000')
    stale.favorites = [{ id: 'saved-swatch', name: 'Saved', color: parseHex('#00FF00') }]
    if (!gate.resolve) throw new Error('Load did not start')
    gate.resolve(stale)
    await loading
    expect(formatHex(manager.snapshot.foreground)).toBe('#123456FF')
    expect(manager.snapshot.favorites[0]?.name).toBe('Saved')
  })
})
