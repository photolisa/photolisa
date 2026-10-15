import type { EditorDocument } from '../core/model/EditorDocument'
import type { AffineMatrix, RasterLayer } from '../core/model/types'
import { layerLocalMatrix, transformPoint } from '../core/geometry/LayerCoordinates'
import { validateRasterBudget } from '../adapters/FileSafety'
import type { RasterSourceRegistry } from './RasterSourceRegistry'

export interface PaintSurfaceExpansion {
  maskSourceId: string | null
  maskBytes: number
  apply(layer: RasterLayer): void
  restore(layer: RasterLayer): void
}

/** Allocate only when the document extends beyond the existing source. */
export function expandPaintSurface(
  document: EditorDocument, layer: RasterLayer, inverse: AffineMatrix, sources: RasterSourceRegistry,
): PaintSurfaceExpansion | null {
  // An explicit image crop remains a clipping frame when painting.
  if (layer.crop) return null
  const source = layer.pixelSourceId ? sources.get(layer.pixelSourceId) : undefined
  const width = source?.width ?? document.dimensions.width
  const height = source?.height ?? document.dimensions.height
  const { width: documentWidth, height: documentHeight } = document.dimensions
  const corners = [{ x: 0, y: 0 }, { x: documentWidth, y: 0 },
    { x: 0, y: documentHeight }, { x: documentWidth, y: documentHeight }]
    .map(point => transformPoint(inverse, point))
  // Quarter-turn transforms can land infinitesimally outside integer edges.
  const left = Math.floor(Math.min(0, ...corners.map(point => point.x)) + 1e-9)
  const top = Math.floor(Math.min(0, ...corners.map(point => point.y)) + 1e-9)
  const right = Math.ceil(Math.max(width, ...corners.map(point => point.x)) - 1e-9)
  const bottom = Math.ceil(Math.max(height, ...corners.map(point => point.y)) - 1e-9)
  if (left === 0 && top === 0 && right === width && bottom === height) return null
  validateRasterBudget(right - left, bottom - top, 'Paint layer')
  const oldTransform = { ...layer.transform }
  const oldMaskId = layer.mask?.pixelSourceId ?? null
  const local = layerLocalMatrix(layer)
  const newTransform = { ...oldTransform,
    x: oldTransform.x + local[0] * left + local[2] * top,
    y: oldTransform.y + local[1] * left + local[3] * top }
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = right - left
  canvas.height = bottom - top
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D canvas is unavailable')
  if (source) context.drawImage(source.image, -left, -top)
  let maskSourceId: string | null = null
  if (layer.mask) {
    const maskCanvas = globalThis.document.createElement('canvas')
    maskCanvas.width = canvas.width
    maskCanvas.height = canvas.height
    const maskContext = maskCanvas.getContext('2d')
    if (!maskContext) throw new Error('2D canvas is unavailable')
    maskContext.fillStyle = layer.mask.inverted ? '#000000' : '#ffffff'
    maskContext.fillRect(0, 0, maskCanvas.width, maskCanvas.height)
    const mask = sources.get(layer.mask.pixelSourceId)
    if (mask) {
      maskContext.clearRect(-left, -top, mask.width, mask.height)
      maskContext.drawImage(mask.image, -left, -top)
    }
    maskSourceId = sources.registerCanvas(maskCanvas)
  }
  const expansion: PaintSurfaceExpansion = {
    maskSourceId, maskBytes: maskSourceId ? canvas.width * canvas.height * 4 : 0,
    apply(target) {
      Object.assign(target.transform, newTransform)
      if (maskSourceId && target.mask) target.mask.pixelSourceId = maskSourceId
    },
    restore(target) {
      Object.assign(target.transform, oldTransform)
      if (oldMaskId && target.mask) target.mask.pixelSourceId = oldMaskId
    },
  }
  layer.pixelSourceId = sources.registerCanvas(canvas)
  expansion.apply(layer)
  return expansion
}
