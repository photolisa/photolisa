import type { ShapeTool, ShapeBounds } from './ShapeTool'
export const hexagonTool: ShapeTool = { id: 'hexagon', label: 'Hexagon', geometry: (b: ShapeBounds) => ({ type: 'polygon', points: [b.width * .25, 0, b.width * .75, 0, b.width, b.height * .5, b.width * .75, b.height, b.width * .25, b.height, 0, b.height * .5] }) }
