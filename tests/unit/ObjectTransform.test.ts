import { describe, expect, it } from 'vitest'
import {
  around,
  captureTransform,
  framePoints,
  resizeDelta,
  rotationDelta,
  setLocalMatrix,
  snapBounds,
  type TransformFrame,
} from '../../src/core/transform/ObjectTransform'
import {
  IDENTITY_MATRIX,
  layerLocalMatrix,
  multiplyAffine,
  transformPoint,
} from '../../src/core/geometry/LayerCoordinates'
import { createLayerBase, type VectorLayer } from '../../src/core/model/types'
import { EditorCore } from '../../src/core/EditorCore'
import { CreateDocumentCommand } from '../../src/core/commands/CreateDocumentCommand'
import { ObjectTransformCommand } from '../../src/core/commands/ObjectTransformCommand'
import { selectedObjects } from '../../src/tools/ObjectBounds'

const rectangle = (): VectorLayer => ({
  ...createLayerBase('rect', 'vector', 'Rectangle'),
  kind: 'vector',
  geometry: { type: 'rect', x: 0, y: 0, width: 100, height: 50, rx: 0, ry: 0 },
  style: { fill: '#000', stroke: null, strokeWidth: 0, fillRule: 'nonzero' },
})
function closePoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x)
  expect(actual.y).toBeCloseTo(expected.y)
}
describe('shared object transform engine', () => {
  it('keeps the opposite corner fixed when resizing a rotated, sheared object', () => {
    const frame: TransformFrame = {
      bounds: { x: 10, y: 20, width: 100, height: 50 },
      matrix: [0, 2, -3, 1, 30, 40],
    }
    const pivot = framePoints(frame)[0]!,
      target = transformPoint(frame.matrix, { x: 210, y: 120 })
    const delta = resizeDelta(frame, { x: 1, y: 1 }, target, false, false)
    closePoint(transformPoint(delta, pivot), pivot)
    closePoint(transformPoint(delta, framePoints(frame)[4]!), target)
  })
  it('proportionally resizes from the center with Shift+Alt', () => {
    const frame: TransformFrame = {
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      matrix: [...IDENTITY_MATRIX],
    }
    const delta = resizeDelta(
      frame,
      { x: 1, y: 1 },
      { x: 150, y: 75 },
      true,
      true,
    )
    closePoint(transformPoint(delta, { x: 50, y: 25 }), { x: 50, y: 25 })
    expect(delta[0]).toBe(2)
    expect(delta[3]).toBe(2)
  })
  it('enforces minimum world dimensions without inverting on handle crossover', () => {
    const frame: TransformFrame = {
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      matrix: [2, 0, 0, 2, 0, 0],
    }
    const delta = resizeDelta(
      frame,
      { x: 1, y: 1 },
      { x: -20, y: -20 },
      false,
      true,
    )
    expect(delta[0]).toBeGreaterThan(0)
    expect(delta[0]).toBe(delta[3])
    expect(delta[3] * 100).toBeGreaterThanOrEqual(1)
  })
  it('snaps rotation to 15 degrees around a custom origin', () => {
    const pivot = { x: 40, y: 60 },
      start = { x: 50, y: 60 },
      angle = (19 * Math.PI) / 180
    const delta = rotationDelta(
      pivot,
      start,
      { x: 40 + Math.cos(angle) * 10, y: 60 + Math.sin(angle) * 10 },
      true,
    )
    closePoint(transformPoint(delta, pivot), pivot)
    expect((Math.atan2(delta[1], delta[0]) * 180) / Math.PI).toBeCloseTo(15)
  })
  it('round-trips affine matrices including reflections and skew', () => {
    for (const matrix of [
      [2, 1, 3, 4, 30, 50],
      [-2, 0, 1, 3, 4, 5],
    ] as const) {
      const layer = rectangle()
      setLocalMatrix(layer, [...matrix])
      layerLocalMatrix(layer).forEach((value, i) =>
        expect(value).toBeCloseTo(matrix[i]!),
      )
    }
  })
  it('uses screen pixel tolerance at different zoom levels and snaps grid and custom guides', () => {
    const bounds = { x: 103, y: 203, width: 20, height: 10 }
    expect(
      snapBounds(bounds, { tolerance: 6, zoom: 1, x: [100], y: [200] }),
    ).toMatchObject({ x: -3, y: -3 })
    expect(
      snapBounds(bounds, { tolerance: 6, zoom: 4, x: [100], y: [200] })
        .vertical,
    ).toBeNull()
    expect(
      snapBounds(bounds, { tolerance: 6, zoom: 1, x: [], y: [], grid: 10 })
        .vertical,
    ).toBe(100)
  })
  it('transforms a selected group once and rejects children of locked ancestors', () => {
    const child = rectangle(),
      group = {
        ...createLayerBase('g', 'group', 'Group'),
        kind: 'group' as const,
        children: [child],
      }
    expect(
      selectedObjects([group], ['g', child.id]).map((e) => e.layer.id),
    ).toEqual(['g'])
    group.locked = true
    expect(selectedObjects([group], [child.id])).toEqual([])
  })
  it('commits a mixed affine change as a single reversible history entry', () => {
    const editor = new EditorCore()
    editor.execute(
      new CreateDocumentCommand({
        name: 'Test',
        width: 300,
        height: 200,
        resolution: 72,
        background: 'transparent',
      }),
    )
    const layer = rectangle()
    editor.layers.insert(layer)
    const before = captureTransform(layer)
    setLocalMatrix(
      layer,
      multiplyAffine(
        around({ x: 50, y: 25 }, [-1, 0, 0, 1, 0, 0]),
        layerLocalMatrix(layer),
      ),
    )
    const after = captureTransform(layer),
      count = editor.history.retainedEntries
    editor.commitExecuted(
      new ObjectTransformCommand('Flip', [{ id: layer.id, before, after }]),
    )
    expect(editor.history.retainedEntries).toBe(count + 1)
    editor.undo()
    expect(captureTransform(layer)).toEqual(before)
    editor.redo()
    expect(captureTransform(layer)).toEqual(after)
  })
})
