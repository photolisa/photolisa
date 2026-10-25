import type { EditorCore } from '../core/EditorCore'
import {
  ObjectTransformCommand,
  type ObjectTransformChange,
} from '../core/commands/ObjectTransformCommand'
import {
  ALIGN_OPERATIONS,
  layerAlignmentDeltas,
  type LayerAlignmentAction,
} from '../core/transform/LayerAlignment'
import {
  captureTransform,
  worldBounds,
} from '../core/transform/ObjectTransform'
import { invertAffine, transformPoint } from '../core/geometry/LayerCoordinates'
import { selectedObjects } from './ObjectBounds'

/** Prepare all states before committing; invalid transforms cannot leave a partial alignment. */
export function alignLayers(
  editor: EditorCore,
  action: LayerAlignmentAction,
): void {
  const doc = editor.document
  if (!doc) return
  const canvas = action.startsWith('canvas-')
  const operation = ALIGN_OPERATIONS.find(
    (op) => action === `${canvas ? 'canvas' : 'align'}-${op}`,
  )
  if (!operation) return
  const entries = selectedObjects(doc.layers, doc.selectedLayerIds)
  if (!canvas && entries.length < 2) return
  const deltas = layerAlignmentDeltas(
    entries.map((e) => ({
      id: e.layer.id,
      bounds: worldBounds({ bounds: e.bounds, matrix: e.world }),
    })),
    operation,
    canvas ? { x: 0, y: 0, ...doc.dimensions } : undefined,
  )
  const changes: ObjectTransformChange[] = []
  for (const e of entries) {
    const delta = deltas.get(e.layer.id)
    if (!delta) continue
    const inverse = invertAffine(e.parent),
      origin = transformPoint(inverse, { x: 0, y: 0 })
    const local = transformPoint(inverse, delta)
    const before = captureTransform(e.layer)
    const transform = {
      ...before.transform,
      x: before.transform.x + local.x - origin.x,
      y: before.transform.y + local.y - origin.y,
    }
    if (!Object.values(transform).every(Number.isFinite))
      throw new Error('Cannot align a layer with an invalid transform')
    changes.push({ id: e.layer.id, before, after: { ...before, transform } })
  }
  if (changes.length)
    editor.execute(
      new ObjectTransformCommand(
        `${operation.startsWith('spacing') ? 'Space' : operation.startsWith('distribute') ? 'Distribute' : 'Align'} Layers`,
        changes,
      ),
    )
}
