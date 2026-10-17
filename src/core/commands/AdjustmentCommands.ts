import type { Command } from './Command'
import type { EditorCore } from '../EditorCore'
import { cloneAdjustment } from '../filters/FilterRegistry'
import type { LayerAdjustment } from '../filters/types'

export class SetLayerAdjustmentsCommand implements Command {
  readonly label = 'Edit Layer Effects'
  readonly memoryCost: number
  private readonly before: LayerAdjustment[]
  private readonly after: LayerAdjustment[]

  constructor(private readonly layerId: string, before: readonly LayerAdjustment[], after: readonly LayerAdjustment[]) {
    this.before = before.map(cloneAdjustment)
    this.after = after.map(cloneAdjustment)
    this.memoryCost = JSON.stringify([this.before, this.after]).length * 2
  }

  execute(editor: EditorCore): void { editor.adjustments.replace(this.layerId, this.after) }
  undo(editor: EditorCore): void { editor.adjustments.replace(this.layerId, this.before) }
}

export class AdjustmentPreviewSession {
  private readonly before: LayerAdjustment[]
  private closed = false

  constructor(private readonly editor: EditorCore, readonly layerId: string) {
    this.before = editor.adjustments.snapshot(layerId)
    if (editor.document?.previewOriginals.size) throw new Error('Finish the current effect preview first')
    editor.document?.previewOriginals.set(layerId, this.before)
  }

  get adjustments(): readonly LayerAdjustment[] { return this.editor.adjustments.list(this.layerId) }

  apply(): boolean {
    this.ensureOpen()
    this.closed = true
    const after = this.editor.adjustments.snapshot(this.layerId)
    this.editor.document?.previewOriginals.delete(this.layerId)
    if (JSON.stringify(this.before) === JSON.stringify(after)) return false
    this.editor.commitExecuted(new SetLayerAdjustmentsCommand(this.layerId, this.before, after))
    return true
  }

  cancel(): void {
    if (this.closed) return
    this.closed = true
    this.editor.adjustments.replace(this.layerId, this.before)
    this.editor.document?.previewOriginals.delete(this.layerId)
  }

  private ensureOpen(): void { if (this.closed) throw new Error('Adjustment preview session is closed') }
}
