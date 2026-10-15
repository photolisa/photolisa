import { describe, expect, it } from 'vitest'
import { createLayerBase, type GroupLayer, type VectorLayer } from '../../src/core/model/types'
import { snapMove } from '../../src/tools/MoveSnapping'

function rectangle(id: string, x: number, y: number): VectorLayer {
  return {
    ...createLayerBase(id, 'vector', id), kind: 'vector',
    geometry: { type: 'rect', x: 0, y: 0, width: 20, height: 10, rx: 0, ry: 0 },
    style: { fill: '#000000', stroke: null, strokeWidth: 0, fillRule: 'nonzero' },
    transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
  }
}

describe('canvas move snapping', () => {
  it('aligns a layer center to the canvas center within the zoom-scaled threshold', () => {
    const layer = rectangle('shape', 88, 44)
    expect(snapMove([layer], layer, 200, 100, 1)).toMatchObject({
      transform: { x: 90, y: 45 }, vertical: 100, horizontal: 50,
    })
    expect(snapMove([layer], layer, 200, 100, 4)).toMatchObject({
      transform: { x: 90, y: 45 }, vertical: 100, horizontal: 50,
    })
    layer.transform.x = 85
    expect(snapMove([layer], layer, 200, 100, 4).vertical).toBeNull()
  })

  it('converts a world-space snap into the parent group coordinate system', () => {
    const child = rectangle('child', 34, 20)
    const group: GroupLayer = {
      ...createLayerBase('group', 'group', 'Group'), kind: 'group', children: [child],
      transform: { x: 10, y: 0, scaleX: 2, scaleY: 2, rotation: 0 },
    }
    const result = snapMove([group], child, 200, 100, 1)
    expect(result.transform.x).toBe(35)
    expect(result.vertical).toBe(100)
  })
})
