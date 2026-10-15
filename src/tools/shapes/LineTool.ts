import type { ShapeTool, ShapeBounds } from './ShapeTool'

export const lineTool: ShapeTool = {
  id: 'line', label: 'Line',
  geometry: (bounds: ShapeBounds) => ({ type: 'line', x1: 0, y1: 0, x2: bounds.width, y2: bounds.height }),
}
