import type { GroupLayer, VectorLayer } from '../model/types'
import { createLayerBase } from '../model/types'
import { booleanPaths, transformGeometryPath } from './PathGeometry'
import { layerLocalMatrix } from '../geometry/LayerCoordinates'
const cache = new WeakMap<
  GroupLayer,
  { signature: string; result: VectorLayer }
>()
export function booleanGroupResult(group: GroupLayer): VectorLayer {
  if (!group.booleanOperation)
    throw new Error('This group has no boolean operation')
  const sources = group.children.filter(
    (layer): layer is VectorLayer => layer.kind === 'vector' && layer.visible,
  )
  const signature = JSON.stringify([group.booleanOperation, sources])
  const previous = cache.get(group)
  if (previous?.signature === signature) return previous.result
  const first = sources[0]
  const d =
    sources.length >= 2
      ? booleanPaths(
          sources.map((layer) => ({
            geometry: layer.geometry,
            matrix: layerLocalMatrix(layer),
            fillRule: layer.style.fillRule,
          })),
          group.booleanOperation,
        )
      : first
        ? transformGeometryPath(first.geometry, layerLocalMatrix(first))
        : ''
  // A single visible operand remains editable and renders as its own path.
  const result: VectorLayer = {
    ...createLayerBase(`${group.id}-result`, 'vector', group.name),
    kind: 'vector',
    geometry: { type: 'path', d },
    style: first
      ? structuredClone(first.style)
      : { fill: '#000000', stroke: null, strokeWidth: 0, fillRule: 'nonzero' },
  }
  cache.set(group, { signature, result })
  return result
}
