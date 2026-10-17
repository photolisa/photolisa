import { describe, expect, it } from 'vitest'
import { filterRegistry } from '../../src/core/filters/FilterRegistry'
import { EXTENDED_EFFECTS } from '../../src/core/filters/EffectCatalog'
import { defaultLut, normalizeLut, normalizeSelection, parseCube } from '../../src/core/filters/EffectPipeline'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { AdjustmentPreviewSession } from '../../src/core/commands/AdjustmentCommands'
import type { PixelBuffer } from '../../src/core/filters/types'
import { EffectPipelineCache } from '../../src/raster/EffectPipelineCache'

function image(): PixelBuffer {
  const width = 16, height = 12, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; data.set([x * 16, y * 20, (x + y) * 8, x < 2 ? 0 : x < 4 ? 128 : 255], i) }
  return { width, height, data }
}

describe('Photo effects', () => {
  for (const kind of Object.keys(EXTENDED_EFFECTS) as Array<keyof typeof EXTENDED_EFFECTS>) {
    it(`${kind} has a functional deterministic processor and does not mutate its source`, () => {
      const source = image(), original = [...source.data], effect = filterRegistry.create(kind)
      const first = filterRegistry.apply(source, [effect]), second = filterRegistry.apply(source, [effect])
      expect(first.width).toBe(source.width); expect(first.height).toBe(source.height)
      expect(first.data.length).toBe(source.data.length)
      expect(first.data).toEqual(second.data)
      expect([...source.data]).toEqual(original)
    })
  }
  it('controls opacity, blend modes, and saved selection coverage', () => {
    const source = { width: 2, height: 1, data: new Uint8ClampedArray([40, 80, 120, 128, 100, 150, 200, 255]) }
    const invert = filterRegistry.create('invert')
    invert.opacity = 0.5; invert.selection = { x: 0, y: 0, width: 1, height: 1, runs: [255, 1] }
    expect([...filterRegistry.apply(source, [invert]).data]).toEqual([128, 128, 128, 128, 100, 150, 200, 255])
    invert.opacity = 0
    expect(filterRegistry.apply(source, [invert]).data).toEqual(source.data)
    invert.opacity = 1; invert.blendMode = 'multiply'; delete invert.selection
    expect([...filterRegistry.apply(source, [invert]).data]).toEqual([34, 55, 64, 128, 61, 62, 43, 255])
  })
  it('preserves neutral settings and darkens vignette corners while preserving alpha', () => {
    const source = { width: 9, height: 9, data: new Uint8ClampedArray(9 * 9 * 4).fill(160) }
    const vignette = filterRegistry.create('vignette', { amount: 0.8 })
    const result = filterRegistry.apply(source, [vignette])
    expect(result.data[(4 * 9 + 4) * 4]).toBe(160)
    expect(result.data[0]).toBeLessThan(50)
    expect(result.data[3]).toBe(160)
    expect(filterRegistry.apply(source, [filterRegistry.create('vignette', { amount: 0 })]).data).toEqual(source.data)
    expect(filterRegistry.apply(source, [filterRegistry.create('film-grain', { amount: 0 })]).data).toEqual(source.data)
  })
  it('does not bleed hidden transparent colors through spatial blurs', () => {
    const source = { width: 3, height: 1, data: new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0]) }
    for (const kind of ['gaussian-blur', 'box-blur', 'motion-blur', 'lens-blur'] as const) {
      const result = filterRegistry.apply(source, [filterRegistry.create(kind)])
      for (let i = 0; i < result.data.length; i += 4) { expect(result.data[i]).toBe(0); if (result.data[i + 3]) expect(result.data[i + 2]).toBe(255) }
    }
  })
  it('validates LUTs and selection dimensions before allocating', () => {
    expect(() => normalizeSelection({ x: 0, y: 0, width: 100000, height: 100000, runs: [255, 10000000000] })).toThrow()
    expect(() => normalizeSelection({ x: 0, y: 0, width: 2, height: 1, runs: [255, 1] })).toThrow()
    expect(() => normalizeLut({ size: 99, data: [] })).toThrow()
    expect(() => parseCube('LUT_1D_SIZE 2')).toThrow()
    expect(() => parseCube('LUT_3D_SIZE 2\nDOMAIN_MIN -1 0 0')).toThrow()
    const lut = defaultLut()
    const text = `TITLE "Warm"\nLUT_3D_SIZE 2\n${Array.from({ length: 8 }, (_, i) => lut.data.slice(i * 3, i * 3 + 3).join(' ')).join('\n')}`
    expect(parseCube(text)).toEqual(lut)
  })
  it('keeps previews out of saved state and commits one undoable edit with full metadata', () => {
    const editor = new EditorCore(), doc = EditorDocument.create({ name: 'Effects', width: 16, height: 12, resolution: 72, background: 'transparent' })
    editor.setDocument(doc); editor.markSaved()
    const id = doc.layers[0]!.id, preview = new AdjustmentPreviewSession(editor, id)
    const effect = filterRegistry.create('vignette', { amount: 0.8 }); effect.opacity = 0.7; effect.blendMode = 'screen'; effect.selection = { x: 0, y: 0, width: 1, height: 1, runs: [200, 1] }
    editor.adjustments.replace(id, [effect])
    expect(editor.isDirty).toBe(false)
    expect(doc.serialize().layers[0]?.adjustments).toEqual([])
    preview.apply()
    expect(editor.isDirty).toBe(true)
    const restored = EditorDocument.deserialize(JSON.parse(JSON.stringify(doc.serialize())))
    expect(restored.layers[0]?.adjustments).toEqual([effect])
    editor.undo(); expect(doc.layers[0]?.adjustments).toEqual([])
    editor.redo(); expect(doc.layers[0]?.adjustments).toEqual([effect])
    editor.markSaved()
    const cancelled = new AdjustmentPreviewSession(editor, id)
    editor.adjustments.add(id, 'film-grain')
    cancelled.cancel()
    expect(editor.isDirty).toBe(false)
    expect(doc.layers[0]?.adjustments).toEqual([effect])
    editor.destroy()
  })
  it('caches intermediate stages without sharing mutable or transferred outputs', () => {
    const pipeline = new EffectPipelineCache(), source = image(), first = filterRegistry.create('sepia'), second = filterRegistry.create('vignette')
    const a = pipeline.process(source, [first, second]); a.data.fill(0)
    const b = pipeline.process(source, [first, second])
    expect(b.data).toEqual(filterRegistry.apply(source, [first, second]).data)
    source.data[0] = 255
    expect(pipeline.process(source, [first, second]).data).toEqual(filterRegistry.apply(source, [first, second]).data)
    second.parameters.amount = 0.9
    expect(pipeline.process(source, [first, second]).data).toEqual(filterRegistry.apply(source, [first, second]).data)
  })
})
