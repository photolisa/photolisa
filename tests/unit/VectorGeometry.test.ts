import { describe, expect, it } from 'vitest'
import {
  booleanPaths,
  cubicAt,
  geometryBounds,
  readSubpaths,
  reverseSubpaths,
  splitSegment,
  toPathData,
  writeSubpaths,
} from '../../src/core/vector/PathGeometry'
import { shapeTools } from '../../src/tools/shapes'
import { IDENTITY_MATRIX } from '../../src/core/geometry/LayerCoordinates'

describe('vector curve geometry', () => {
  it('calculates true cubic extrema rather than control-point bounds', () => {
    const b = geometryBounds({ type: 'path', d: 'M0 0 C0 100 100 100 100 0' })
    expect(b).toMatchObject({ x: 0, y: 0, width: 100 })
    expect(b.height).toBeCloseTo(75)
  })
  it('subdivides a cubic without changing its shape', () => {
    const paths = readSubpaths({
        type: 'path',
        d: 'M0 0 C20 100 80 100 100 0',
      }),
      path = paths[0]!
    const a = path.anchors[0]!,
      b = path.anchors[1]!
    const sample = cubicAt(a.point, a.outgoing, b.incoming, b.point, 0.25)
    splitSegment(path, 0, 0.5)
    const first = path.anchors[0]!,
      middle = path.anchors[1]!
    const subdivided = cubicAt(
      first.point,
      first.outgoing,
      middle.incoming,
      middle.point,
      0.5,
    )
    expect(subdivided.x).toBeCloseTo(sample.x)
    expect(subdivided.y).toBeCloseTo(sample.y)
    expect(
      readSubpaths({ type: 'path', d: writeSubpaths(paths) })[0]!.anchors,
    ).toHaveLength(3)
  })
  it('supports SVG arcs, relative commands, multiple subpaths and negative coordinates', () => {
    const paths = readSubpaths({
      type: 'path',
      d: 'm-20 -20 h40 v40 h-40 z M0 0 a10 10 0 0 1 20 0',
    })
    expect(paths).toHaveLength(2)
    expect(paths[0]!.closed).toBe(true)
    expect(paths[1]!.anchors.length).toBeGreaterThan(1)
    expect(
      geometryBounds({ type: 'path', d: writeSubpaths(reverseSubpaths(paths)) })
        .width,
    ).toBeCloseTo(40)
  })
  it('creates all additional shapes and tolerates zero-size paths', () => {
    for (const tool of Object.values(shapeTools))
      expect(
        toPathData(
          tool.geometry({ x: 0, y: 0, width: 100, height: 80 }, 12, 5),
        ),
      ).toContain('M')
    expect(geometryBounds({ type: 'path', d: '' }).width).toBe(0)
  })
  it('performs curve booleans including disjoint results and holes', () => {
    const a = {
      geometry: {
        type: 'rect' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rx: 0,
        ry: 0,
      },
      matrix: IDENTITY_MATRIX,
      fillRule: 'nonzero' as const,
    }
    const b = { ...a, geometry: { ...a.geometry, x: 50 } }
    for (const operation of [
      'union',
      'subtract',
      'intersect',
      'exclude',
      'divide',
    ] as const)
      expect(booleanPaths([a, b], operation)).toContain('M')
    expect(
      geometryBounds({ type: 'path', d: booleanPaths([a, b], 'intersect') })
        .width,
    ).toBeCloseTo(50)
    const hole = {
      ...a,
      geometry: { ...a.geometry, x: 25, y: 25, width: 50, height: 50 },
    }
    expect(
      readSubpaths({ type: 'path', d: booleanPaths([a, hole], 'subtract') }),
    ).toHaveLength(2)
    expect(
      booleanPaths(
        [a, { ...b, geometry: { ...b.geometry, x: 200 } }],
        'intersect',
      ),
    ).toBe('')
  })
})

import { fillContours, dashedPathData } from '../../src/core/vector/PathGeometry'
import { validatePathSyntax } from '../../src/core/vector/PathSyntax'
import {
  resizeTransform,
  rotateTransform,
  transformLocal,
} from '../../src/core/vector/Transform'
import { alignmentTransforms } from '../../src/core/vector/Alignment'
import { createLayerBase, type VectorLayer } from '../../src/core/model/types'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import {
  AddShapeCommand,
  SetVectorGeometryCommand,
} from '../../src/core/commands/VectorCommands'
import {
  BooleanGroupCommand,
  FlattenBooleanCommand,
} from '../../src/core/commands/VectorOperations'
import { booleanGroupResult } from '../../src/core/vector/BooleanGroup'
import { VectorStylePreview } from '../../src/core/vector/VectorStylePreview'

describe('vector operations and edge cases', () => {
  const rect = {
    type: 'rect' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rx: 0,
    ry: 0,
  }
  const style = {
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 2,
    fillRule: 'nonzero' as const,
  }
  it('emits explicit GPU holes for evenodd compound paths and nonzero subtraction', () => {
    const geometry = {
      type: 'path' as const,
      d: 'M0 0H100V100H0Z M25 25H75V75H25Z',
    }
    expect(fillContours(geometry, 'evenodd')[0]!.holes).toHaveLength(1)
    expect(fillContours(geometry, 'nonzero')[0]!.holes).toHaveLength(0)
    const subtract = booleanPaths(
      [
        { geometry: rect, matrix: IDENTITY_MATRIX, fillRule: 'nonzero' },
        {
          geometry: { ...rect, x: 25, y: 25, width: 50, height: 50 },
          matrix: IDENTITY_MATRIX,
          fillRule: 'nonzero',
        },
      ],
      'subtract',
    )
    expect(
      fillContours({ type: 'path', d: subtract }, 'nonzero')[0]!.holes,
    ).toHaveLength(1)
  })
  it('preserves the opposite resize pivot and supports negative scale and center constraints', () => {
    const before = {
        x: 50,
        y: 60,
        scaleX: 1,
        scaleY: 1,
        rotation: Math.PI / 4,
      },
      bounds = { x: 10, y: 20, width: 100, height: 80 },
      pivot = { x: 10, y: 20 }
    const resized = resizeTransform(
      before,
      bounds,
      { x: 1, y: 1 },
      transformLocal({ x: -90, y: 100 }, before),
      false,
      false,
    )
    expect(resized.scaleX).toBeCloseTo(-1)
    expect(transformLocal(pivot, resized).x).toBeCloseTo(
      transformLocal(pivot, before).x,
    )
    expect(transformLocal(pivot, resized).y).toBeCloseTo(
      transformLocal(pivot, before).y,
    )
    const center = { x: 60, y: 60 },
      constrained = resizeTransform(
        before,
        bounds,
        { x: 1, y: 1 },
        transformLocal({ x: 160, y: 100 }, before),
        true,
        true,
      )
    expect(constrained.scaleX).toBeCloseTo(constrained.scaleY)
    expect(transformLocal(center, constrained).x).toBeCloseTo(
      transformLocal(center, before).x,
    )
    const rotated = rotateTransform(before, bounds, Math.PI)
    expect(transformLocal(center, rotated).y).toBeCloseTo(
      transformLocal(center, before).y,
    )
  })
  it('retains exact cubic dashed segments', () => {
    const dashed = dashedPathData(
      { type: 'path', d: 'M0 0C0 100 100 100 100 0' },
      [10, 10],
    )
    expect(dashed).toContain('c')
    expect(readSubpaths({ type: 'path', d: dashed }).length).toBeGreaterThan(2)
  })
  it.each([
    'M0',
    'L0 0',
    'M1e999 0',
    'M0 0A10 10 0 2 0 20 20',
    'M0 0Z 10 10',
    'M0 0<script>',
  ])('rejects invalid or oversized SVG path %s', (d) =>
    expect(() => validatePathSyntax(d)).toThrow(),
  )
  it('aligns in world coordinates through a scaled parent', () => {
    const layer: VectorLayer = {
      ...createLayerBase('a', 'vector', 'a'),
      kind: 'vector',
      geometry: rect,
      style,
    }
    const transforms = alignmentTransforms(
      [{ layer, world: [2, 0, 0, 2, 40, 20], parent: [2, 0, 0, 2, 40, 20] }],
      'right',
      { x: 0, y: 0, width: 500, height: 300 },
    )
    expect(transforms.get('a')!.x).toBeCloseTo(130)
  })
  it('preserves live boolean source editing through undo, redo, flatten and native serialization', () => {
    const editor = new EditorCore()
    editor.setDocument(
      EditorDocument.create({
        name: 'Boolean',
        width: 300,
        height: 200,
        resolution: 72,
        background: 'transparent',
      }),
    )
    editor.execute(new AddShapeCommand('A', 0, 0, rect, style, 1))
    const a = editor.document!.activeLayerId!
    editor.execute(new AddShapeCommand('B', 50, 0, rect, style, 1))
    const b = editor.document!.activeLayerId!
    editor.execute(new BooleanGroupCommand([a, b], 'intersect'))
    const group = editor.layers.find(editor.document!.activeLayerId!)
    if (group?.kind !== 'group') throw new Error('Expected boolean group')
    expect(
      geometryBounds(booleanGroupResult(group).geometry).width,
    ).toBeCloseTo(50)
    editor.execute(new SetVectorGeometryCommand(b, { ...rect, width: 20 }))
    expect(
      geometryBounds(booleanGroupResult(group).geometry).width,
    ).toBeCloseTo(20)
    editor.undo()
    expect(
      geometryBounds(booleanGroupResult(group).geometry).width,
    ).toBeCloseTo(50)
    const reopened = EditorDocument.deserialize(
      editor.document!.serialize(),
    ).layers.find((layer) => layer.id === group.id)
    expect(reopened?.kind === 'group' && reopened.booleanOperation).toBe(
      'intersect',
    )
    editor.execute(new FlattenBooleanCommand(group.id))
    expect(editor.layers.find(group.id)?.kind).toBe('vector')
    editor.undo()
    expect(editor.layers.find(group.id)?.kind).toBe('group')
    editor.undo()
    expect(editor.layers.find(a)?.kind).toBe('vector')
    expect(editor.layers.find(group.id)).toBeNull()
    editor.redo()
    expect(editor.layers.find(group.id)?.kind).toBe('group')
  })
  it('records one history entry per paint preview and deep copies gradient stops', () => {
    const editor = new EditorCore()
    editor.setDocument(
      EditorDocument.create({
        name: 'Paint',
        width: 300,
        height: 200,
        resolution: 72,
        background: 'transparent',
      }),
    )
    editor.execute(new AddShapeCommand('A', 0, 0, rect, style, 1))
    const id = editor.document!.activeLayerId!,
      preview = new VectorStylePreview()
    preview.update(editor, id, { fillOpacity: 0.4 })
    preview.update(editor, id, { fillOpacity: 0.2 })
    preview.commit()
    expect(editor.history.retainedEntries).toBe(2)
    editor.undo()
    expect(
      (editor.layers.find(id) as VectorLayer).style.fillOpacity,
    ).toBeUndefined()
    preview.update(editor, id, { fillOpacity: 0.1 })
    preview.cancel()
    expect(
      (editor.layers.find(id) as VectorLayer).style.fillOpacity,
    ).toBeUndefined()
  })
})

import { VectorClipboard } from '../../src/core/vector/VectorClipboard'
import { GroupLayersCommand } from '../../src/core/commands/LayerCommands'
import { lineEndpoints } from '../../src/tools/shapes/ShapeTool'
import {
  splitPathAtAnchor,
  joinOpenPaths,
} from '../../src/core/vector/PathGeometry'

it('copies editable nested vectors between documents with independent histories', () => {
  const source = new EditorCore(),
    destination = new EditorCore()
  for (const editor of [source, destination])
    editor.setDocument(
      EditorDocument.create({
        name: 'Project',
        width: 300,
        height: 200,
        resolution: 72,
        background: 'transparent',
      }),
    )
  source.execute(
    new AddShapeCommand(
      'Curve',
      12,
      20,
      { type: 'path', d: 'M0 0C10 30 20 30 30 0' },
      { fill: null, stroke: '#f00', strokeWidth: 2, fillRule: 'nonzero' },
      1,
    ),
  )
  const id = source.document!.activeLayerId!
  source.execute(new GroupLayersCommand([id]))
  const group = source.layers.find(source.document!.activeLayerId!)!
  group.transform.x = 40
  source.layers.select(id, 'replace')
  const clipboard = new VectorClipboard()
  expect(clipboard.copy(source)).toBe(true)
  expect(clipboard.paste(destination)).toBe(true)
  const pasted = destination.layers.find(
    destination.document!.activeLayerId!,
  ) as VectorLayer
  expect(pasted.id).not.toBe(id)
  expect(pasted.geometry).toEqual(
    (source.layers.find(id) as VectorLayer).geometry,
  )
  expect(pasted.svgMatrix?.[4]).toBe(52)
  destination.undo()
  expect(destination.layers.find(pasted.id)).toBeNull()
  expect(source.layers.find(id)).not.toBeNull()
  destination.redo()
  expect(destination.layers.find(pasted.id)?.kind).toBe('vector')
})

it('splits and reconnects exact Bézier subpaths and constrains centered lines', () => {
  const path = readSubpaths({
    type: 'path',
    d: 'M0 0C10 20 20 20 30 0L50 0',
  })[0]!
  const split = splitPathAtAnchor(path, 1)
  expect(split).toHaveLength(2)
  const joined = joinOpenPaths(split)
  expect(joined).toHaveLength(1)
  expect(joined[0]!.anchors).toHaveLength(4)
  const line = lineEndpoints({ x: 50, y: 50 }, { x: 100, y: 70 }, true, true)
  expect(line.start.x + line.end.x).toBeCloseTo(100)
  expect(line.start.y + line.end.y).toBeCloseTo(100)
  expect(line.end.y).toBeCloseTo(50)
})

import { createVectorArtwork } from '../../src/core/vector/VectorCreation'
import { JoinVectorLayersCommand } from '../../src/core/commands/JoinVectorLayersCommand'
import { UngroupLayerCommand } from '../../src/core/commands/LayerCommands'
it('appends a subpath using the active vector coordinate system and preserves its paint', () => {
  const editor = new EditorCore(); editor.setDocument(EditorDocument.create({ name: 'Compound', width: 300, height: 200, resolution: 72, background: 'transparent' }))
  const style = { fill: '#f00', stroke: null, strokeWidth: 0, fillRule: 'nonzero' as const }
  editor.execute(new AddShapeCommand('A', 50, 20, { type: 'rect', x: 0, y: 0, width: 20, height: 20, rx: 0, ry: 0 }, style, 1))
  const id = editor.document!.activeLayerId!
  createVectorArtwork(editor, 'B', 100, 20, { type: 'circle', cx: 10, cy: 10, r: 10 }, { ...style, fill: '#00f' }, .5, 'compound')
  const layer = editor.layers.find(id) as VectorLayer
  expect(readSubpaths(layer.geometry)).toHaveLength(2); expect(layer.style.fill).toBe('#f00')
  expect(geometryBounds(layer.geometry).width).toBeCloseTo(70)
  editor.undo(); expect((editor.layers.find(id) as VectorLayer).geometry.type).toBe('rect')
})
it('joins sibling layers and preserves transforms through grouping and ungrouping', () => {
  const editor = new EditorCore(); editor.setDocument(EditorDocument.create({ name: 'Join', width: 300, height: 200, resolution: 72, background: 'transparent' }))
  const style = { fill: null, stroke: '#f00', strokeWidth: 2, fillRule: 'nonzero' as const }, geometry = { type: 'path' as const, d: 'M0 0L20 0' }
  editor.execute(new AddShapeCommand('A', 0, 0, geometry, style, 1)); const a = editor.document!.activeLayerId!
  editor.execute(new AddShapeCommand('B', 30, 0, geometry, style, 1)); const b = editor.document!.activeLayerId!
  editor.execute(new JoinVectorLayersCommand([a, b])); const joined = editor.layers.find(editor.document!.activeLayerId!) as VectorLayer
  expect(readSubpaths(joined.geometry)[0]!.anchors).toHaveLength(4)
  editor.undo(); expect(editor.layers.find(a)).not.toBeNull(); expect(editor.layers.find(b)).not.toBeNull()
  editor.execute(new GroupLayersCommand([a, b])); const group = editor.layers.find(editor.document!.activeLayerId!)!
  group.transform.x = 40
  editor.execute(new UngroupLayerCommand(group.id)); expect(editor.layers.find(a)?.svgMatrix?.[4]).toBe(40)
  editor.undo(); expect(editor.layers.find(group.id)?.transform.x).toBe(40)
})
