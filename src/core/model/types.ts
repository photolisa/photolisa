import type { LayerAdjustment } from '../filters/types'

export type LayerKind = 'raster' | 'vector' | 'text' | 'group'
export type AffineMatrix = [number, number, number, number, number, number]
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay'

export interface LayerTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
}

export interface LayerBase {
  readonly id: string
  readonly kind: LayerKind
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: BlendMode
  transform: LayerTransform
  aspectRatioLocked?: boolean
  svgMatrix?: AffineMatrix
  adjustments: LayerAdjustment[]
  mask: LayerMask | null
}

export interface LayerMask {
  pixelSourceId: string
  enabled: boolean
  inverted: boolean
}

export interface LayerImageCrop { x: number; y: number; width: number; height: number; offsetX: number; offsetY: number }

export interface RasterLayer extends LayerBase {
  readonly kind: 'raster'
  crop?: LayerImageCrop
  pixelSourceId: string | null
}

export interface TextLayer extends LayerBase {
  readonly kind: 'text'
  textBox?: { width: number; height: number }
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  alignment: 'left' | 'center' | 'right'
  color: string
  lineSpacing: number
}

export type VectorGeometry =
  | { type: 'path'; d: string }
  | { type: 'rect'; x: number; y: number; width: number; height: number; rx: number; ry: number }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { type: 'polygon'; points: number[]; parametric?: { kind: 'polygon' | 'star'; sides: number; innerRadius: number } }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }

export interface VectorGradient {
  type: 'linear' | 'radial'
  units?: 'objectBoundingBox' | 'userSpaceOnUse'
  transform?: AffineMatrix
  focus?: { x: number; y: number }
  start: { x: number; y: number }
  end: { x: number; y: number }
  stops: Array<{ offset: number; color: string; opacity?: number }>
}

export interface VectorStyle {
  fillGradient?: VectorGradient
  strokeAlignment?: 'inside' | 'center' | 'outside'
  strokeCap?: 'round' | 'square' | 'butt'
  strokeJoin?: 'miter' | 'round' | 'bevel'
  strokeDash?: number[]
  scaleStroke?: boolean
  startArrow?: boolean
  endArrow?: boolean
  fill: string | null
  stroke: string | null
  strokeWidth: number
  fillRule: 'nonzero' | 'evenodd'
  fillOpacity?: number
  strokeOpacity?: number
}

export interface VectorLayer extends LayerBase {
  readonly kind: 'vector'
  geometry: VectorGeometry
  style: VectorStyle
}

export interface GroupLayer extends LayerBase {
  readonly kind: 'group'
  booleanOperation?: 'union' | 'subtract' | 'intersect' | 'exclude' | 'divide'
  children: Layer[]
}

export type Layer = RasterLayer | VectorLayer | TextLayer | GroupLayer

export interface DocumentDimensions {
  width: number
  height: number
  resolution: number
}

export interface NewDocumentOptions extends DocumentDimensions {
  name: string
  background: 'transparent' | 'white'
}

export interface ImportedDocumentOptions extends DocumentDimensions {
  name: string
  pixelSourceId: string
}

export interface DocumentMetadata {
  createdAt: string
  modifiedAt: string
  sourceFormat?: 'image' | 'psd' | 'photolisa' | 'svg' | 'pdf'
  pdfPage?: { number: number; widthPoints: number; heightPoints: number; rotation: number }
  svgViewBox?: { x: number; y: number; width: number; height: number }
  compatibilityWarnings?: string[]
}

export interface SerializedEditorDocument {
  version: 1 | 2 | 3
  id: string
  name: string
  dimensions: DocumentDimensions
  background: NewDocumentOptions['background']
  layers: Layer[]
  selectedLayerIds: string[]
  activeLayerId: string | null
  revision: number
  metadata?: DocumentMetadata
}

export const IDENTITY_TRANSFORM: Readonly<LayerTransform> = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
}

export function createLayerBase(id: string, kind: LayerKind, name: string): LayerBase {
  return {
    id,
    kind,
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: { ...IDENTITY_TRANSFORM },
    adjustments: [],
    mask: null,
  }
}

