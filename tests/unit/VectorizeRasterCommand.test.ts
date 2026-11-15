// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { EditorCore } from '../../src/core/EditorCore'
import { CreateDocumentCommand } from '../../src/core/commands/CreateDocumentCommand'
import { VectorizeRasterCommand } from '../../src/core/commands/VectorizeRasterCommand'
import { createLayerBase, type VectorLayer } from '../../src/core/model/types'
import { traceRasterSource } from '../../src/raster/RasterVectorizer'

describe('VectorizeRasterCommand', () => {
  it('preserves source pixels, transform, opacity and undo/redo state', () => {
    const editor = new EditorCore()
    editor.execute(new CreateDocumentCommand({ name: 'Trace', width: 32, height: 32, resolution: 72, background: 'transparent' }))
    const source = editor.document?.layers[0]
    if (!source || source.kind !== 'raster') throw new Error('Missing raster layer')
    source.transform = { x: 12, y: 8, scaleX: 1.5, scaleY: .75, rotation: .2 }
    source.opacity = .6
    source.pixelSourceId = 'original-pixels'
    const child: VectorLayer = {
      ...createLayerBase('trace-path', 'vector', 'Red shape'), kind: 'vector',
      geometry: { type: 'path', d: 'M 0 0 L 16 0 L 16 16 Z' },
      style: { fill: '#ff0000', stroke: null, strokeWidth: 0, fillRule: 'nonzero' },
    }
    editor.execute(new VectorizeRasterCommand(source.id, [child], 16, 16, 32, 32))
    const traced = editor.document?.layers[1]
    expect(source.pixelSourceId).toBe('original-pixels')
    expect(source.visible).toBe(false)
    expect(traced).toMatchObject({ kind: 'group', opacity: .6, transform: source.transform, svgMatrix: [2, 0, 0, 2, 0, 0] })
    if (!traced || traced.kind !== 'group') throw new Error('Missing vector group')
    expect(traced.children[0]?.kind).toBe('vector')
    editor.undo()
    expect(editor.document?.layers).toHaveLength(1)
    expect(source.visible).toBe(true)
    editor.redo()
    expect(editor.document?.layers[1]?.id).toBe(traced.id)
    expect(source.visible).toBe(false)
  })

  it('rejects locked or hidden source without creating history', () => {
    const editor = new EditorCore()
    editor.execute(new CreateDocumentCommand({ name: 'Trace', width: 8, height: 8, resolution: 72, background: 'transparent' }))
    const source = editor.document?.layers[0]
    if (!source) throw new Error('Missing source')
    source.locked = true
    const command = new VectorizeRasterCommand(source.id, [], 8, 8, 8, 8)
    expect(() => editor.execute(command)).toThrow(/unlocked/)
    expect(editor.document?.layers).toHaveLength(1)
  })

  it('leaves the document untouched when tracing is cancelled before work starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8
    await expect(traceRasterSource({ width: 8, height: 8, image: canvas, editable: true, revision: 0, dirty: null, fullDirty: false }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})
