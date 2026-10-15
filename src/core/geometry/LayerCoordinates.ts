import type { AffineMatrix, Layer } from '../model/types'

export interface Point { x: number; y: number }
export const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 1, 0, 0]

export function multiplyAffine(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  const [a, b, c, d, x, y] = left
  const [e, f, g, h, u, v] = right
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h, a * u + c * v + x, b * u + d * v + y]
}

export function layerLocalMatrix(layer: Layer): AffineMatrix {
  const { x, y, scaleX, scaleY, rotation } = layer.transform
  const cosine = Math.cos(rotation), sine = Math.sin(rotation)
  const transform: AffineMatrix = [cosine * scaleX, sine * scaleX, -sine * scaleY, cosine * scaleY, x, y]
  return layer.svgMatrix ? multiplyAffine(transform, layer.svgMatrix) : transform
}

export function invertAffine(matrix: AffineMatrix): AffineMatrix {
  const [a, b, c, d, x, y] = matrix
  const determinant = a * d - b * c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) throw new Error('The layer transform is not invertible')
  return [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * y - d * x) / determinant, (b * x - a * y) / determinant]
}

export function transformPoint(matrix: AffineMatrix, point: Point): Point {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] }
}

/** Returns null if the target is not an editable raster or any ancestor blocks editing. */
export function editableRasterWorldMatrix(layers: readonly Layer[], id: string, parent: AffineMatrix = IDENTITY_MATRIX, editable = true): AffineMatrix | null {
  for (const layer of layers) {
    const allowed = editable && layer.visible && !layer.locked
    if (!allowed) continue
    const world = multiplyAffine(parent, layerLocalMatrix(layer))
    if (layer.id === id) return layer.kind === 'raster' ? layer.crop ? multiplyAffine(world, [1, 0, 0, 1, layer.crop.offsetX, layer.crop.offsetY]) : world : null
    if (layer.kind === 'group') {
      const child = editableRasterWorldMatrix(layer.children, id, world, allowed)
      if (child) return child
    }
  }
  return null
}

export function layerWorldMatrix(layers: readonly Layer[], id: string, parent: AffineMatrix = IDENTITY_MATRIX): AffineMatrix | null {
  for (const layer of layers) { const world = multiplyAffine(parent, layerLocalMatrix(layer)); if (layer.id === id) return world; if (layer.kind === 'group') { const child = layerWorldMatrix(layer.children, id, world); if (child) return child } }
  return null
}
