import type { EditorCore } from '../EditorCore'
import type { RemovedLayer } from '../layers/LayerManager'
import type { Command } from './Command'

/** Removes source roots as one atomic, undoable source-project operation. */
export class MoveLayersCommand implements Command {
  readonly label = 'Move Layers to Project'
  readonly memoryCost = 512
  private removed: RemovedLayer[] = []
  private previousSelection: { ids: string[]; activeId: string | null } | null = null

  constructor(readonly layerIds: readonly string[]) {}

  execute(editor: EditorCore): void {
    const document = editor.document
    if (!document) throw new Error('Source project is closed')
    this.previousSelection ??= { ids: [...document.selectedLayerIds], activeId: document.activeLayerId }
    const originalLocations = this.layerIds.map((id) => {
      const location = editor.layers.locationOf(id)
      if (!location) throw new Error(`Layer ${id} no longer exists`)
      return location
    })
    const removed: RemovedLayer[] = []
    try {
      this.layerIds.forEach((id, index) => removed.push({ ...editor.layers.remove(id), ...originalLocations[index]! }))
      this.removed = removed
    } catch (error) {
      restore(editor, removed)
      document.selectedLayerIds = [...this.previousSelection.ids]
      document.activeLayerId = this.previousSelection.activeId
      throw error
    }
  }

  undo(editor: EditorCore): void {
    restore(editor, this.removed)
    const document = editor.document
    if (document && this.previousSelection) {
      document.selectedLayerIds = [...this.previousSelection.ids]
      document.activeLayerId = this.previousSelection.activeId
      editor.events.emit('document:changed', document)
    }
  }
}

function restore(editor: EditorCore, removed: readonly RemovedLayer[]): void {
  // Reinsert lower indices first. The parent of each selected root remains in place.
  for (const entry of [...removed].sort((a, b) => a.parentId === b.parentId ? a.index - b.index : 0)) {
    editor.layers.insert(entry.layer, entry.parentId, entry.index)
  }
}
