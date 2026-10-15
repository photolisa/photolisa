import type { VectorGeometry } from '../core/model/types'
import type { Point } from '../core/geometry/LayerCoordinates'
import type {
  Rect,
  TransformFrame,
  TransformState,
} from '../core/transform/ObjectTransform'
import type { ObjectEntry } from './ObjectBounds'

export interface CanvasControls {
  x: number
  y: number
  count: number
  groupable: boolean
  locked: boolean
  crop: boolean
  aspectLocked: boolean
}
export type CanvasAction =
  | 'duplicate'
  | 'delete'
  | 'lock'
  | 'group'
  | 'front'
  | 'back'
  | 'flip-x'
  | 'flip-y'
  | 'finish-crop'
  | 'aspect'
export interface Entry extends ObjectEntry {
  before: TransformState
}
export interface Drag {
  pointer: number
  action:
    | 'move'
    | 'resize'
    | 'rotate'
    | 'skew'
    | 'marquee'
    | 'crop-move'
    | 'crop-resize'
    | 'radius'
    | 'free'
  start: Point
  last: Point
  frame: TransformFrame | null
  entries: Entry[]
  handle: Point
  pivot: Point
  selection: string[]
  active: string | null
  additive: boolean
  duplicated: boolean
  changed: boolean
  geometryBefore: VectorGeometry | null
  targets: Rect[]
}
