import { describe, expect, it } from 'vitest'
import { layerAlignmentDeltas } from '../../src/core/transform/LayerAlignment'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import {
  createLayerBase,
  type RasterLayer,
  type VectorLayer,
  type GroupLayer,
} from '../../src/core/model/types'
import { alignLayers } from '../../src/tools/AlignLayers'
import { objectEntries } from '../../src/tools/ObjectBounds'
import { worldBounds } from '../../src/core/transform/ObjectTransform'

function shape(id: string, x: number, y: number, width = 20): VectorLayer {
  return {
    ...createLayerBase(id, 'vector', id),
    kind: 'vector',
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: { type: 'rect', x: 0, y: 0, width, height: 20, rx: 0, ry: 0 },
    style: {
      fill: '#ff0000',
      stroke: null,
      strokeWidth: 0,
      fillRule: 'nonzero',
    },
  }
}
function setup() {
  const editor = new EditorCore()
  const doc = EditorDocument.create({
    name: 'Alignment',
    width: 300,
    height: 200,
    resolution: 72,
    background: 'transparent',
  })
  const a = shape('a', 20, 30),
    b = shape('b', 70, 50, 40),
    c = shape('c', 180, 100)
  doc.layers.splice(0, 1, a, b, c)
  doc.selectedLayerIds = [a.id, b.id, c.id]
  doc.activeLayerId = a.id
  editor.setDocument(doc)
  return { editor, doc, a, b, c }
}

describe('layer alignment', () => {
  it('aligns edges and centers in one undoable command without changing geometry', () => {
    const { editor, a, b, c } = setup()
    const geometry = structuredClone(b.geometry)
    alignLayers(editor, 'align-left')
    expect([a.transform.x, b.transform.x, c.transform.x]).toEqual([20, 20, 20])
    expect(editor.history.retainedEntries).toBe(1)
    editor.undo()
    expect([a.transform.x, b.transform.x, c.transform.x]).toEqual([20, 70, 180])
    editor.redo()
    expect(c.transform.x).toBe(20)
    expect(b.geometry).toEqual(geometry)
    alignLayers(editor, 'align-center-y')
    expect([a.transform.y, b.transform.y, c.transform.y]).toEqual([65, 65, 65])
  })
  it('distributes centers and equal gaps while preserving the outer layers', () => {
    const { editor, a, b, c } = setup()
    alignLayers(editor, 'align-distribute-x')
    expect([a.transform.x, b.transform.x, c.transform.x]).toEqual([20, 90, 180])
    editor.undo()
    alignLayers(editor, 'align-spacing-x')
    expect([a.transform.x, b.transform.x, c.transform.x]).toEqual([20, 90, 180])
    alignLayers(editor, 'align-spacing-y')
    expect([a.transform.y, b.transform.y, c.transform.y]).toEqual([30, 65, 100])
  })
  it('aligns a mixed raster/vector selection through a rotated, scaled group exactly once', () => {
    const { editor, doc, a, b } = setup()
    const raster: RasterLayer = {
      ...createLayerBase('image', 'raster', 'Image'),
      kind: 'raster',
      pixelSourceId: 'original',
      crop: { x: 0, y: 0, width: 40, height: 30, offsetX: 5, offsetY: 2 },
    }
    const group: GroupLayer = {
      ...createLayerBase('g', 'group', 'Group'),
      kind: 'group',
      children: [a],
      transform: { x: 200, y: 0, scaleX: 2, scaleY: 2, rotation: Math.PI / 2 },
    }
    doc.layers.splice(0, doc.layers.length, group, b, raster)
    doc.selectedLayerIds = [group.id, a.id, b.id, raster.id]
    alignLayers(editor, 'align-top')
    const entries = objectEntries(doc.layers).filter(
      (e) => doc.selectedLayerIds.includes(e.layer.id) && e.layer.id !== a.id,
    )
    for (const e of entries)
      expect(worldBounds({ bounds: e.bounds, matrix: e.world }).y).toBeCloseTo(
        0,
      )
    expect(a.transform).toMatchObject({ x: 20, y: 30 })
    expect(raster.pixelSourceId).toBe('original')
    expect(raster.crop?.offsetX).toBe(5)
    editor.undo()
    expect(group.transform.y).toBe(0)
    expect(b.transform.y).toBe(50)
    doc.selectedLayerIds = [a.id, raster.id]
    alignLayers(editor, 'align-top')
    const child = objectEntries(doc.layers).find((e) => e.layer.id === a.id)
    if (!child) throw new Error('Missing child')
    expect(
      worldBounds({ bounds: child.bounds, matrix: child.world }).y,
    ).toBeCloseTo(0)
  })
  it('aligns a single layer to canvas and skips locked and hidden layers', () => {
    const { editor, doc, a, b, c } = setup()
    b.locked = true
    c.visible = false
    doc.selectedLayerIds = [a.id, b.id, c.id]
    alignLayers(editor, 'canvas-center-x')
    expect(a.transform.x).toBe(140)
    expect(b.transform.x).toBe(70)
    expect(c.transform.x).toBe(180)
    alignLayers(editor, 'canvas-bottom')
    expect(a.transform.y).toBe(180)
    const count = editor.history.retainedEntries
    alignLayers(editor, 'canvas-bottom')
    alignLayers(editor, 'align-spacing-x')
    expect(editor.history.retainedEntries).toBe(count)
  })
  it('rejects invalid bounds before changing any layer', () => {
    expect(() =>
      layerAlignmentDeltas(
        [{ id: 'bad', bounds: { x: NaN, y: 0, width: 20, height: 20 } }],
        'left',
      ),
    ).toThrow('invalid bounds')
  })
  it('distinguishes equal centers from equal gaps for different outer widths', () => {
    const items = [
      { id: 'a', bounds: { x: 10, y: 0, width: 10, height: 10 } },
      { id: 'b', bounds: { x: 40, y: 0, width: 20, height: 10 } },
      { id: 'c', bounds: { x: 110, y: 0, width: 30, height: 10 } },
    ]
    expect(layerAlignmentDeltas(items, 'distribute-x').get('b')?.x).toBe(20)
    expect(layerAlignmentDeltas(items, 'spacing-x').get('b')?.x).toBe(15)
  })
})
