import { editableRasterWorldMatrix, transformPoint } from '../core/geometry/LayerCoordinates'
import type { EditorCore } from '../core/EditorCore'
import type { EffectSelection } from '../core/filters/types'
import type { RasterLayer } from '../core/model/types'
import { rasterSources } from './RasterSourceRegistry'
/** Freeze document-space selection into source coordinates, including ancestor/crop transforms. */
export function captureEffectSelection(editor: EditorCore, layer: RasterLayer): EffectSelection | undefined {
  if (!editor.selection || !editor.document) return undefined
  const source = layer.pixelSourceId ? rasterSources.get(layer.pixelSourceId) : null
  const width = source?.width ?? editor.document.dimensions.width, height = source?.height ?? editor.document.dimensions.height
  if (width * height > 16_777_216) throw new Error('Selection effects support up to 16 megapixels; apply to the full layer or resize first')
  const matrix = editableRasterWorldMatrix(editor.document.layers, layer.id)
  if (!matrix) throw new Error('Unlock and show the layer before applying selection effects')
  let left = width, top = height, right = 0, bottom = 0
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const point = transformPoint(matrix, { x: x + 0.5, y: y + 0.5 }), value = editor.selection.coverageAt(point.x, point.y)
    data[y * width + x] = value
    if (value) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1) }
  }
  if (right <= left || bottom <= top) throw new Error('The selection does not overlap this layer')
  const runs: number[] = []; let last = -1, count = 0
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const value = data[y * width + x] ?? 0
    if (value === last) count++
    else { if (count) runs.push(last, count); last = value; count = 1 }
  }
  runs.push(last, count)
  if (runs.length > 2_000_000) throw new Error('Selection is too complex for an effect mask; simplify or feather it first')
  return { x: left, y: top, width: right - left, height: bottom - top, runs }
}
