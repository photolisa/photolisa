import { describe, it, expect } from 'vitest'
import {
  clampImageOffset,
  resizeImageCrop,
} from '../../src/core/transform/ImageCrop'
import { spacingMeasurements } from '../../src/core/transform/SmartGuides'
import {
  freeTransformDelta,
  rotationDelta,
  type TransformFrame,
} from '../../src/core/transform/ObjectTransform'
import { IDENTITY_MATRIX, transformPoint } from '../../src/core/geometry/LayerCoordinates'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import {
  createLayerBase,
  type RasterLayer,
  type TextLayer,
} from '../../src/core/model/types'

const crop = { x: 20, y: 10, width: 100, height: 50, offsetX: 0, offsetY: 0 }
describe('image frames and smart guides', () => {
  it('resizes the frame around its center and keeps the image covering it', () => {
    const result = resizeImageCrop(
      crop,
      { x: 1, y: 1 },
      { x: 150, y: 75 },
      { x: 0, y: 0, width: 200, height: 120 },
      true,
      true,
    )
    expect(result.width / result.height).toBeCloseTo(2)
    expect(
      clampImageOffset({ ...crop, offsetX: -300, offsetY: 100 }, 200, 120),
    ).toMatchObject({ offsetX: -80, offsetY: 10 })
  })
  it('selects nearest spacing on each side and excludes overlaps', () => {
    const selection = { x: 100, y: 100, width: 40, height: 40 }
    const measurements = spacingMeasurements(
      selection,
      [
        { x: 180, y: 110, width: 40, height: 20 },
        { x: 220, y: 110, width: 40, height: 20 },
        { x: 120, y: 120, width: 40, height: 40 },
      ],
      100,
    )
    expect(measurements).toHaveLength(1)
    expect(measurements[0]?.distance).toBe(40)
  })
  it('moves an affine free-transform corner while fixing the opposite edge', () => {
    const frame: TransformFrame = {
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      matrix: [...IDENTITY_MATRIX],
    }
    const delta = freeTransformDelta(
      frame,
      { x: 1, y: 0 },
      { x: 100, y: 0 },
      { x: 120, y: -10 },
    )
    expect(transformPoint(delta, { x: 100, y: 0 })).toEqual({ x: 120, y: -10 })
    expect(transformPoint(delta, { x: 0, y: 50 }).y).toBeCloseTo(50)
    expect(transformPoint(delta, { x: 100, y: 50 }).x).toBeCloseTo(100)
  })
  it('snaps an already-rotated object to absolute 15-degree angles', () => {
    const angle = (1 * Math.PI) / 180,
      before = (19 * Math.PI) / 180
    const delta = rotationDelta(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: Math.cos(angle), y: Math.sin(angle) },
      true,
      before,
    )
    expect(
      ((Math.atan2(delta[1], delta[0]) + before) * 180) / Math.PI,
    ).toBeCloseTo(15)
  })
  it('preserves crop and text-box state in native documents and deep copies it', () => {
    const doc = EditorDocument.create({
      name: 'Test',
      width: 200,
      height: 120,
      resolution: 72,
      background: 'transparent',
    })
    const image = doc.layers[0] as RasterLayer
    image.crop = { ...crop }
    const text: TextLayer = {
      ...createLayerBase('text', 'text', 'Text'),
      kind: 'text',
      text: 'Hello',
      fontFamily: 'Arial',
      fontSize: 24,
      fontWeight: 400,
      fontStyle: 'normal',
      alignment: 'left',
      color: '#000000',
      lineSpacing: 1.2,
      textBox: { width: 120, height: 60 },
    }
    doc.layers.push(text)
    const serialized = doc.serialize(),
      restored = EditorDocument.deserialize(serialized)
    expect((restored.layers[0] as RasterLayer).crop).toEqual(crop)
    expect((restored.layers[1] as TextLayer).textBox).toEqual({
      width: 120,
      height: 60,
    })
    image.crop.width = 50
    text.textBox!.width = 50
    expect((serialized.layers[0] as RasterLayer).crop!.width).toBe(100)
    expect((serialized.layers[1] as TextLayer).textBox!.width).toBe(120)
    const invalid = doc.serialize()
    ;(invalid.layers[1] as TextLayer).textBox!.height = 100000
    expect(() => EditorDocument.deserialize(invalid)).toThrow(
      'Invalid text box',
    )
  })
})
