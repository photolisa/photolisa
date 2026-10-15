import { rectangleTool } from './RectangleTool'
import { roundedRectangleTool } from './RoundedRectangleTool'
import { circleTool } from './CircleTool'
import { ellipseTool } from './EllipseTool'
import { hexagonTool } from './HexagonTool'
import { lineTool } from './LineTool'
import { polygonTool } from './PolygonTool'

import { triangleTool, starTool, arrowTool, customShapeTool } from './AdditionalShapes'

export const shapeTools = { triangle: triangleTool, star: starTool, arrow: arrowTool, 'custom-shape': customShapeTool, rectangle: rectangleTool, 'rounded-rectangle': roundedRectangleTool, circle: circleTool, ellipse: ellipseTool, hexagon: hexagonTool, line: lineTool, polygon: polygonTool } as const
export type ShapeToolId = keyof typeof shapeTools
export function isShapeTool(value: string): value is ShapeToolId { return value in shapeTools }
