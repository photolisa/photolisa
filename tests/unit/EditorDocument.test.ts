import { describe, expect, it } from 'vitest'
import { EditorDocument } from '../../src/core/model/EditorDocument'

describe('EditorDocument', () => {
  it('creates a valid document with one raster layer', () => {
    const document = EditorDocument.create({
      name: 'Poster', width: 1200, height: 800, resolution: 300, background: 'transparent',
    })

    expect(document.name).toBe('Poster')
    expect(document.dimensions).toEqual({ width: 1200, height: 800, resolution: 300 })
    expect(document.background).toBe('transparent')
    expect(document.layers).toHaveLength(1)
    expect(document.layers[0]?.kind).toBe('raster')
    expect(document.activeLayerId).toBe(document.layers[0]?.id)
  })

  it.each([
    ['empty name', { name: '', width: 10, height: 10, resolution: 72, background: 'white' as const }],
    ['zero width', { name: 'A', width: 0, height: 10, resolution: 72, background: 'white' as const }],
    ['excessive height', { name: 'A', width: 10, height: 20_000, resolution: 72, background: 'white' as const }],
  ])('rejects %s', (_case, options) => {
    expect(() => EditorDocument.create(options)).toThrow()
  })
})
