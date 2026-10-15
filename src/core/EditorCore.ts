import { CommandHistory } from './commands/CommandHistory'
import type { Command } from './commands/Command'
import { EditorEventBus } from './events/EditorEventBus'
import type { EditorDocument } from './model/EditorDocument'
import { LayerManager } from './layers/LayerManager'
import { AdjustmentManager } from './filters/AdjustmentManager'
import type { SelectionMask } from './selection/SelectionMask'

export class EditorCore {
  readonly events = new EditorEventBus()
  readonly history = new CommandHistory()
  document: EditorDocument | null = null
  vectorSegment: { layerId: string; subpath: number; index: number } | null = null
  vectorAnchor: { layerId: string; subpath: number; index: number } | null = null
  selection: SelectionMask | null = null
  maskEditingLayerId: string | null = null
  textEditingLayerId: string | null = null
  isDirty = false
  readonly layers = new LayerManager(
    () => this.document,
    (document) => this.onDocumentMutation(document),
    (document) => this.events.emit('document:changed', document),
  )
  readonly adjustments = new AdjustmentManager(
    () => this.document,
    (document) => this.onDocumentMutation(document),
  )

  execute(command: Command): void {
    this.history.execute(command, this)
    if (command.affectsDocument !== false) this.setDirty(true)
    this.emitHistory()
  }

  commitExecuted(command: Command): void {
    this.history.commitExecuted(command)
    this.markDocumentChanged()
    this.emitHistory()
    this.setDirty(true)
  }

  beginTransaction(label: string): void { this.history.beginTransaction(label) }
  commitTransaction(): void { this.history.commitTransaction(); this.emitHistory() }
  cancelTransaction(): void { this.history.cancelTransaction(this); this.emitHistory() }

  undo(): void {
    const command = this.history.undo(this)
    this.emitHistory()
    if (command && command.affectsDocument !== false) this.setDirty(true)
  }

  redo(): void {
    const command = this.history.redo(this)
    this.emitHistory()
    if (command && command.affectsDocument !== false) this.setDirty(true)
  }

  setDocument(document: EditorDocument | null): void {
    this.document = document
    this.vectorAnchor = null
    this.vectorSegment = null
    this.selection = null
    this.maskEditingLayerId = null
    this.textEditingLayerId = null
    this.events.emit('document:changed', document)
  }

  setSelection(selection: SelectionMask | null): void {
    if (selection && this.document && (selection.documentWidth !== this.document.dimensions.width || selection.documentHeight !== this.document.dimensions.height)) throw new Error('Selection does not fit the document')
    this.selection = selection
    this.events.emit('selection:changed', selection)
  }

  setMaskEditing(layerId: string | null): void {
    this.maskEditingLayerId = layerId
    this.events.emit('document:changed', this.document)
  }

  setTextEditing(layerId: string | null): void {
    this.textEditingLayerId = layerId
    this.events.emit('document:changed', this.document)
  }

  markSaved(): void { this.setDirty(false) }

  markDocumentChanged(): void {
    this.document?.touch()
    this.events.emit('document:changed', this.document)
    this.setDirty(true)
  }

  private readonly resourceDisposers = new Set<() => void>()

  /** Retain external assets for this session, including undo and recently closed state. */
  retainResource(dispose: () => void): void { this.resourceDisposers.add(dispose) }

  destroy(): void {
    this.history.clear()
    for (const dispose of this.resourceDisposers) dispose()
    this.resourceDisposers.clear()
    this.events.clear()
    this.document = null
    this.selection = null
    this.maskEditingLayerId = null
    this.textEditingLayerId = null
  }

  private setDirty(value: boolean): void {
    if (this.isDirty === value) return
    this.isDirty = value
    this.events.emit('dirty:changed', value)
  }

  private onDocumentMutation(document: EditorDocument): void {
    this.setDirty(true)
    this.events.emit('document:changed', document)
  }

  private emitHistory(): void {
    this.events.emit('history:changed', {
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    })
  }
}
