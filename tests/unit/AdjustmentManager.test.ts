import { beforeEach, describe, expect, it } from 'vitest'
import { AdjustmentPreviewSession } from '../../src/core/commands/AdjustmentCommands'
import { CreateDocumentCommand } from '../../src/core/commands/CreateDocumentCommand'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'

describe('AdjustmentManager', () => {
  let editor: EditorCore
  let layerId: string

  beforeEach(() => {
    editor = new EditorCore()
    editor.execute(new CreateDocumentCommand({ name: 'Adjust', width: 16, height: 12, resolution: 72, background: 'transparent' }))
    const layer = editor.document?.layers[0]
    if (!layer || layer.kind !== 'raster') throw new Error('Expected raster layer')
    layer.pixelSourceId = 'original-pixels'
    layerId = layer.id
    editor.history.clear()
  })

  it('previews, applies, undoes, and redoes an ordered non-destructive stack', () => {
    const preview = new AdjustmentPreviewSession(editor, layerId)
    const exposure = editor.adjustments.add(layerId, 'exposure', { stops: 1.25 })
    const invert = editor.adjustments.add(layerId, 'invert')
    editor.adjustments.setEnabled(layerId, invert.id, false)
    editor.adjustments.move(layerId, exposure.id, 1)
    expect(preview.apply()).toBe(true)

    const layer = editor.layers.find(layerId)
    if (!layer || layer.kind !== 'raster') throw new Error('Expected raster layer')
    expect(layer.pixelSourceId).toBe('original-pixels')
    expect(layer.adjustments.map((adjustment) => adjustment.id)).toEqual([invert.id, exposure.id])
    editor.undo()
    expect(layer.adjustments).toEqual([])
    expect(layer.pixelSourceId).toBe('original-pixels')
    editor.redo()
    expect(layer.adjustments).toHaveLength(2)
  })

  it('cancels a preview and serializes stable IDs and parameters', () => {
    const cancelled = new AdjustmentPreviewSession(editor, layerId)
    editor.adjustments.add(layerId, 'hue', { degrees: 45 })
    cancelled.cancel()
    expect(editor.adjustments.list(layerId)).toEqual([])

    const applied = new AdjustmentPreviewSession(editor, layerId)
    const levels = editor.adjustments.add(layerId, 'levels', { inputBlack: 12, inputWhite: 230, gamma: 1.4 })
    applied.apply()
    const serialized = editor.document?.serialize()
    if (!serialized) throw new Error('Expected serialized document')
    const restored = EditorDocument.deserialize(JSON.parse(JSON.stringify(serialized)))
    const restoredLayer = restored.layers[0]
    expect(restoredLayer?.adjustments[0]).toEqual(levels)
  })
})
