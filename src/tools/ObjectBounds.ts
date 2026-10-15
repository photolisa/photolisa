import type { AffineMatrix, Layer } from '../core/model/types'
import { geometryBounds } from '../core/vector/PathGeometry'
import {
  unionBounds,
  worldBounds,
  type Rect,
} from '../core/transform/ObjectTransform'
import {
  IDENTITY_MATRIX,
  layerLocalMatrix,
  multiplyAffine,
} from '../core/geometry/LayerCoordinates'
import { rasterSources } from '../raster/RasterSourceRegistry'
import { textPixelSize } from '../raster/TextPainter'
export function objectBounds(layer: Layer): Rect | null {
  if (layer.kind === 'vector') {
    const b = geometryBounds(layer.geometry)
    return { ...b, width: Math.max(1, b.width), height: Math.max(1, b.height) }
  }
  if (layer.kind === 'raster') {
    if (layer.crop) return { ...layer.crop }
    const source = layer.pixelSourceId
      ? rasterSources.get(layer.pixelSourceId)
      : null
    return source
      ? { x: 0, y: 0, width: source.width, height: source.height }
      : null
  }
  if (layer.kind === 'text') {
    try {
      return { x: 0, y: 0, ...textPixelSize(layer) }
    } catch {
      return null
    }
  }
  const children = layer.children
    .filter((c) => c.visible)
    .flatMap((c) => {
      const bounds = objectBounds(c)
      return bounds
        ? [worldBounds({ bounds, matrix: layerLocalMatrix(c) })]
        : []
    })
  return children.length ? unionBounds(children) : null
}
export interface ObjectEntry {
  layer: Layer
  parent: AffineMatrix
  world: AffineMatrix
  bounds: Rect
  editable: boolean
}
export function objectEntries(
  layers: readonly Layer[],
  parent = IDENTITY_MATRIX,
  editable = true,
): ObjectEntry[] {
  const result: ObjectEntry[] = []
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue
    const world = multiplyAffine(parent, layerLocalMatrix(layer)),
      allowed = editable && !layer.locked,
      bounds = objectBounds(layer)
    if (bounds) result.push({ layer, parent, world, bounds, editable: allowed })
    if (layer.kind === 'group')
      result.push(...objectEntries(layer.children, world, allowed))
  }
  return result
}
/** Selected descendants of selected groups are excluded so each object moves exactly once. */
export function selectedObjects(
  layers: readonly Layer[],
  ids: readonly string[],
): ObjectEntry[] {
  const selected = new Set(ids),
    result: ObjectEntry[] = []
  const visit = (
    tree: readonly Layer[],
    parent: AffineMatrix,
    editable: boolean,
  ): void => {
    for (const layer of tree) {
      if (!layer.visible || layer.opacity <= 0) continue
      const world = multiplyAffine(parent, layerLocalMatrix(layer)),
        allowed = editable && !layer.locked
      if (selected.has(layer.id)) {
        const determinant = world[0] * world[3] - world[1] * world[2]
        if (
          allowed &&
          Number.isFinite(determinant) &&
          Math.abs(determinant) >= 1e-10
        ) {
          const bounds = objectBounds(layer)
          if (bounds)
            result.push({ layer, parent, world, bounds, editable: true })
        }
        // Selected descendants of this root must never be transformed twice.
        continue
      }
      if (layer.kind === 'group' && allowed)
        visit(layer.children, world, allowed)
    }
  }
  visit(layers, IDENTITY_MATRIX, true)
  return result
}

/** Effective editability includes every ancestor, without measuring geometry. */
export function isObjectEditable(
  layers: readonly Layer[],
  id: string,
  editable = true,
): boolean {
  for (const layer of layers) {
    const allowed =
      editable && layer.visible && !layer.locked && layer.opacity > 0
    if (layer.id === id) return allowed
    if (layer.kind === 'group' && isObjectEditable(layer.children, id, allowed))
      return true
  }
  return false
}
