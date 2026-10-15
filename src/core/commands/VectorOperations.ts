import type { Command } from './Command'
import type { EditorCore } from '../EditorCore'
import type { GroupLayer, VectorLayer } from '../model/types'
import type { RemovedLayer } from '../layers/LayerManager'
import type { BooleanOperation } from '../vector/PathGeometry'
import { booleanGroupResult } from '../vector/BooleanGroup'
import { createLayerBase } from '../model/types'

export class BooleanGroupCommand implements Command {
  readonly label: string
  private grouped: RemovedLayer | null = null
  constructor(
    private ids: readonly string[],
    private operation: BooleanOperation,
  ) {
    this.label = `Boolean ${operation}`
  }
  execute(editor: EditorCore): void {
    if (this.grouped) {
      editor.layers.regroup(
        this.grouped.layer as GroupLayer,
        this.grouped.parentId,
        this.grouped.index,
      )
      return
    }
    if (
      this.ids.length < 2 ||
      this.ids.some((id) => {
        const layer = editor.layers.find(id)
        return layer?.kind !== 'vector' || layer.locked
      })
    )
      throw new Error('Select at least two unlocked vector shapes in one group')
    this.grouped = editor.layers.group(this.ids, this.label)
    const group = this.grouped.layer as GroupLayer
    group.booleanOperation = this.operation
    try {
      booleanGroupResult(group)
    } catch (error) {
      editor.layers.ungroup(group.id)
      this.grouped = null
      throw error
    }
    editor.markDocumentChanged()
  }
  undo(editor: EditorCore): void {
    if (this.grouped) editor.layers.ungroup(this.grouped.layer.id)
  }
}
export class FlattenBooleanCommand implements Command {
  readonly label = 'Flatten Boolean Group'
  private original: RemovedLayer | null = null
  private result: VectorLayer | null = null
  constructor(private id: string) {}
  execute(editor: EditorCore): void {
    const group = editor.layers.find(this.id)
    if (
      !group ||
      group.kind !== 'group' ||
      !group.booleanOperation ||
      group.locked
    )
      throw new Error('Select an unlocked boolean group')
    const { children: _children, booleanOperation: _operation, ...base } = group
    this.result ??= {
      ...createLayerBase(group.id, 'vector', group.name),
      ...base,
      kind: 'vector',
      geometry: structuredClone(booleanGroupResult(group).geometry),
      style: structuredClone(booleanGroupResult(group).style),
    }
    this.original = editor.layers.remove(group.id)
    editor.layers.insert(
      this.result,
      this.original.parentId,
      this.original.index,
    )
  }
  undo(editor: EditorCore): void {
    if (this.original) {
      editor.layers.remove(this.id)
      editor.layers.insert(
        this.original.layer,
        this.original.parentId,
        this.original.index,
      )
    }
  }
}
