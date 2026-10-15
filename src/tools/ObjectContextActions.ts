import type { EditorCore } from '../core/EditorCore'
import {
  ObjectTransformCommand,
  SetObjectAspectLockCommand,
} from '../core/commands/ObjectTransformCommand'
import {
  DeleteLayerCommand,
  DuplicateLayerCommand,
  GroupLayersCommand,
  MoveLayerCommand,
  SetLayerLockedCommand,
} from '../core/commands/LayerCommands'
import {
  around,
  captureTransform,
  setLocalMatrix,
} from '../core/transform/ObjectTransform'
import { invertAffine, multiplyAffine } from '../core/geometry/LayerCoordinates'
import { selectedObjects } from './ObjectBounds'
import { selectionFrame } from './ObjectHandles'
import type { CanvasAction } from './ObjectInteractionState'

export function performObjectAction(
  editor: EditorCore,
  action: Exclude<CanvasAction, 'finish-crop'>,
  select: (ids: string[]) => void,
  onError: (message: string) => void,
): void {
  const doc = editor.document
  if (!doc) return
  const ids = [...doc.selectedLayerIds],
    entries = selectedObjects(doc.layers, doc.selectedLayerIds)
  if (!ids.length) return
  editor.beginTransaction(action)
  try {
    if (action === 'aspect') {
      const locked = entries.every((e) => e.layer.aspectRatioLocked)
      entries.forEach((e) =>
        editor.execute(new SetObjectAspectLockCommand(e.layer.id, !locked)),
      )
    } else if (action === 'group')
      editor.execute(new GroupLayersCommand(entries.map((e) => e.layer.id)))
    else if (action === 'flip-x' || action === 'flip-y') {
      const frame = selectionFrame(entries)
      if (frame) {
        const b = frame.bounds,
          delta = multiplyAffine(
            frame.matrix,
            multiplyAffine(
              around(
                { x: b.x + b.width / 2, y: b.y + b.height / 2 },
                action === 'flip-x' ? [-1, 0, 0, 1, 0, 0] : [1, 0, 0, -1, 0, 0],
              ),
              invertAffine(frame.matrix),
            ),
          )
        const changes = entries.map((e) => {
          const before = captureTransform(e.layer)
          setLocalMatrix(
            e.layer,
            multiplyAffine(
              invertAffine(e.parent),
              multiplyAffine(delta, e.world),
            ),
          )
          return { id: e.layer.id, before, after: captureTransform(e.layer) }
        })
        editor.commitExecuted(
          new ObjectTransformCommand('Flip Objects', changes),
        )
      }
    } else if (action === 'lock') {
      const locked = ids.every((id) => editor.layers.find(id)?.locked)
      for (const id of ids)
        editor.execute(new SetLayerLockedCommand(id, !locked))
    } else if (action === 'front' || action === 'back') {
      const ordered = action === 'back' ? [...entries].reverse() : entries
      for (const e of ordered) {
        const location = editor.layers.locationOf(e.layer.id)
        if (!location) continue
        const parent = location.parentId
          ? editor.layers.find(location.parentId)
          : null
        const siblings = parent?.kind === 'group' ? parent.children : doc.layers
        editor.execute(
          new MoveLayerCommand(
            e.layer.id,
            location.parentId,
            action === 'front' ? siblings.length : 0,
          ),
        )
      }
      select(ids)
    } else {
      const copies: string[] = []
      for (const e of entries) {
        editor.execute(
          action === 'duplicate'
            ? new DuplicateLayerCommand(e.layer.id)
            : new DeleteLayerCommand(e.layer.id),
        )
        if (action === 'duplicate' && doc.activeLayerId)
          copies.push(doc.activeLayerId)
      }
      if (action === 'duplicate') select(copies)
    }
    editor.commitTransaction()
  } catch (error) {
    editor.cancelTransaction()
    select(ids)
    onError(error instanceof Error ? error.message : 'Object action failed')
  }
}
