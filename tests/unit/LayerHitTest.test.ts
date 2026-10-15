import { describe, expect, it } from 'vitest'
import { createLayerBase, type GroupLayer, type VectorLayer } from '../../src/core/model/types'
import { layerAtPoint } from '../../src/tools/LayerHitTest'

describe('canvas layer selection', () => {
  it('finds the topmost editable shape through group transforms', () => {
    const first: VectorLayer = {
      ...createLayerBase('first', 'vector', 'First'), kind: 'vector',
      geometry: { type: 'rect', x: 0, y: 0, width: 20, height: 20, rx: 0, ry: 0 },
      style: { fill: '#000000', stroke: null, strokeWidth: 0, fillRule: 'nonzero' },
    }
    const second: VectorLayer = {
      ...createLayerBase('second', 'vector', 'Second'), kind: 'vector',
      geometry: { type: 'rect', x: 0, y: 0, width: 20, height: 20, rx: 0, ry: 0 },
      style: { fill: '#ffffff', stroke: null, strokeWidth: 0, fillRule: 'nonzero' },
      transform: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0 },
    }
    const group: GroupLayer = {
      ...createLayerBase('group', 'group', 'Group'), kind: 'group', children: [first, second],
      transform: { x: 100, y: 50, scaleX: 2, scaleY: 2, rotation: 0 },
    }
    expect(layerAtPoint([group], { x: 116, y: 66 }, 1)?.id).toBe('second')
    expect(layerAtPoint([group], { x: 102, y: 52 }, 1)?.id).toBe('first')
    second.locked = true
    expect(layerAtPoint([group], { x: 116, y: 66 }, 1)?.id).toBe('first')
    expect(layerAtPoint([group], { x: 10, y: 10 }, 1)).toBeNull()
  })
})
