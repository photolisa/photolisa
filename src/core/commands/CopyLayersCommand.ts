import type { EditorCore } from '../EditorCore'
import type { Layer } from '../model/types'
import type { Command } from './Command'

/** Inserts already-prepared layer trees. IDs and asset references remain stable across redo. */
export class CopyLayersCommand implements Command {
  readonly label = 'Copy Layers to Project'
  readonly memoryCost: number
  private previousSelection: { ids: string[]; activeId: string | null } | null = null

  constructor(
    readonly layers: readonly Layer[],
    private readonly parentId: string | null = null,
    private readonly index?: number,
  ) {
    this.memoryCost = JSON.stringify(layers).length * 2
  }

  execute(editor: EditorCore): void {
    const document = editor.document
    if (!document) throw new Error('Destination project is closed')
    this.previousSelection ??= { ids: [...document.selectedLayerIds], activeId: document.activeLayerId }
    const inserted: string[] = []
    try {
      const start = this.index ?? (this.parentId ? groupChildren(editor, this.parentId).length : document.layers.length)
      this.layers.forEach((layer, offset) => {
        editor.layers.insert(layer, this.parentId, start + offset)
        inserted.push(layer.id)
      })
      document.selectedLayerIds = [...inserted]
      document.activeLayerId = inserted.at(-1) ?? null
      editor.events.emit('document:changed', document)
    } catch (error) {
      for (const id of inserted.reverse()) editor.layers.remove(id)
      document.selectedLayerIds = [...this.previousSelection.ids]
      document.activeLayerId = this.previousSelection.activeId
      throw error
    }
  }

  undo(editor: EditorCore): void {
    for (const layer of [...this.layers].reverse()) editor.layers.remove(layer.id)
    const document = editor.document
    if (document && this.previousSelection) {
      document.selectedLayerIds = [...this.previousSelection.ids]
      document.activeLayerId = this.previousSelection.activeId
      editor.events.emit('document:changed', document)
    }
  }
}

function groupChildren(editor: EditorCore, id: string): readonly Layer[] {
  const group = editor.layers.find(id)
  if (group?.kind !== 'group') throw new Error('Destination parent must be a group')
  return group.children
}
