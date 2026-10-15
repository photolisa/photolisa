import { describe, expect, it } from 'vitest'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { CanvasSizeCommand, RotateFlipCanvasCommand } from '../../src/core/commands/DocumentGeometryCommands'
import { SelectionMask } from '../../src/core/selection/SelectionMask'
import { layerLocalMatrix, transformPoint } from '../../src/core/geometry/LayerCoordinates'

describe('document geometry commands', () => {
  it('centers a resized canvas and restores selection on undo', () => {
    const editor = new EditorCore()
    editor.setDocument(EditorDocument.create({ name: 'Canvas', width: 10, height: 8, resolution: 72, background: 'transparent' }))
    const layer = editor.document!.layers[0]!
    layer.transform.x = 2; layer.transform.y = 1
    const selection = SelectionMask.rectangle(10, 8, { x: 1, y: 1, width: 2, height: 2 })
    editor.setSelection(selection)
    editor.execute(new CanvasSizeCommand(14, 12, 'center'))
    expect(editor.document!.dimensions).toMatchObject({ width: 14, height: 12 })
    expect(layer.transform).toMatchObject({ x: 4, y: 3 })
    expect(editor.selection).toBeNull()
    editor.undo()
    expect(layer.transform).toMatchObject({ x: 2, y: 1 })
    expect(editor.selection).toBe(selection)
    editor.redo()
    expect(layer.transform).toMatchObject({ x: 4, y: 3 })
  })

  it('rotates and flips top-level layer coordinates without changing sources', () => {
    const editor = new EditorCore()
    editor.setDocument(EditorDocument.createFromImage({ name: 'Rotate', width: 10, height: 6, resolution: 72, pixelSourceId: 'original' }))
    const layer = editor.document!.layers[0]!
    editor.execute(new RotateFlipCanvasCommand('rotate-cw'))
    expect(editor.document!.dimensions).toMatchObject({ width: 6, height: 10 })
    expect(transformPoint(layerLocalMatrix(layer), { x: 2, y: 1 })).toEqual({ x: 5, y: 2 })
    expect(layer.kind === 'raster' && layer.pixelSourceId).toBe('original')
    editor.undo()
    expect(editor.document!.dimensions).toMatchObject({ width: 10, height: 6 })
    expect(transformPoint(layerLocalMatrix(layer), { x: 2, y: 1 })).toEqual({ x: 2, y: 1 })
    editor.redo()
    expect(transformPoint(layerLocalMatrix(layer), { x: 2, y: 1 })).toEqual({ x: 5, y: 2 })
    editor.execute(new RotateFlipCanvasCommand('flip-horizontal'))
    expect(transformPoint(layerLocalMatrix(layer), { x: 2, y: 1 })).toEqual({ x: 1, y: 2 })
  })
})
