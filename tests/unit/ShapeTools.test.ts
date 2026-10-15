import { describe, expect, it } from 'vitest'
import { shapeBounds } from '../../src/tools/shapes/ShapeTool'
import { shapeTools } from '../../src/tools/shapes'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { AddShapeCommand, SetVectorGeometryCommand, SetVectorStyleCommand } from '../../src/core/commands/VectorCommands'
import type { VectorLayer } from '../../src/core/model/types'
import { packNativeProject, unpackNativeProject } from '../../src/adapters/NativeProjectFormat'
import { resizeShape } from '../../src/tools/shapes/ShapeProperties'

describe('editable shape tools', () => {
  it('interprets Shift and Alt in document coordinates', () => {
    expect(shapeBounds({ x: 20, y: 20 }, { x: 30, y: 25 }, false, true)).toEqual({ x: 20, y: 20, width: 10, height: 10 })
    expect(shapeBounds({ x: 20, y: 20 }, { x: 30, y: 25 }, true, false)).toEqual({ x: 10, y: 15, width: 20, height: 10 })
    expect(shapeBounds({ x: 20, y: 20 }, { x: 10, y: 25 }, true, true)).toEqual({ x: 10, y: 10, width: 20, height: 20 })
  })

  it('builds native editable geometry for all shape tools', () => {
    const bounds = { x: 3, y: 4, width: 80, height: 60 }
    expect(shapeTools.rectangle.geometry(bounds, 0)).toMatchObject({ type: 'rect', width: 80, height: 60, rx: 0 })
    expect(shapeTools['rounded-rectangle'].geometry(bounds, 12)).toMatchObject({ type: 'rect', rx: 12, ry: 12 })
    expect(shapeTools.circle.geometry(bounds, 0)).toMatchObject({ type: 'circle', r: 30 })
    expect(shapeTools.ellipse.geometry(bounds, 0)).toMatchObject({ type: 'ellipse', rx: 40, ry: 30 })
    expect(shapeTools.hexagon.geometry(bounds, 0)).toMatchObject({ type: 'polygon', points: [20, 0, 60, 0, 80, 30, 60, 60, 20, 60, 0, 30] })
    expect(shapeTools.line.geometry(bounds, 0)).toEqual({ type: 'line', x1: 0, y1: 0, x2: 80, y2: 60 })
    const pentagon = shapeTools.polygon.geometry(bounds, 0, 5)
    expect(pentagon.type).toBe('polygon')
    if (pentagon.type === 'polygon') expect(pentagon.points).toHaveLength(10)
    expect(resizeShape({ type: 'ellipse', cx: 50, cy: 40, rx: 20, ry: 10 }, 'width', 60)).toMatchObject({ cx: 60, rx: 30, cy: 40 })
  })

  it('creates, edits, undoes, and serializes a stable vector layer', () => {
    const editor = new EditorCore()
    editor.setDocument(EditorDocument.create({ name: 'Shapes', width: 300, height: 200, resolution: 72, background: 'transparent' }))
    const style = { fill: '#ff0000', stroke: null, strokeWidth: 0, fillRule: 'nonzero' as const }
    editor.execute(new AddShapeCommand('Rectangle', 12, 18, shapeTools.rectangle.geometry({ x: 12, y: 18, width: 40, height: 20 }, 0), style, .5))
    const shape = editor.document?.layers.at(-1) as VectorLayer
    const id = shape.id
    editor.execute(new SetVectorStyleCommand(id, { ...style, fill: '#00ff00' }))
    if (shape.geometry.type !== 'rect') throw new Error('Expected rectangle')
    editor.execute(new SetVectorGeometryCommand(id, { ...shape.geometry, width: 50 }))
    expect((editor.document?.serialize().layers.at(-1) as VectorLayer).geometry).toMatchObject({ width: 50 })
    const saved = packNativeProject(editor.document!.serialize(), [])
    const reopened = unpackNativeProject(saved).manifest.document
    const restored = reopened.layers.at(-1) as VectorLayer
    expect(restored.id).toBe(id)
    expect(restored.geometry).toMatchObject({ type: 'rect', width: 50 })
    expect(restored.style.fill).toBe('#00ff00')
    editor.undo(); editor.undo()
    expect((editor.layers.find(id) as VectorLayer).style.fill).toBe('#ff0000')
    editor.undo()
    expect(editor.layers.find(id)).toBeNull()
    editor.redo()
    expect(editor.layers.find(id)?.id).toBe(id)
  })
})
