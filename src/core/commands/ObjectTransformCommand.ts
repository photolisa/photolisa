import type { EditorCore } from '../EditorCore'
import type { Command } from './Command'
import {
  restoreTransform,
  type TransformState,
} from '../transform/ObjectTransform'
export interface ObjectTransformChange {
  id: string
  before: TransformState
  after: TransformState
}
/** One history entry for a mixed-layer gesture; affine transforms never resample source pixels. */
export class ObjectTransformCommand implements Command {
  readonly memoryCost: number
  constructor(
    readonly label: string,
    private readonly changes: readonly ObjectTransformChange[],
  ) {
    this.memoryCost = changes.length * 320
  }
  execute(editor: EditorCore): void {
    this.apply(editor, 'after')
  }
  undo(editor: EditorCore): void {
    this.apply(editor, 'before')
  }
  private apply(editor: EditorCore, state: 'before' | 'after'): void {
    for (const change of this.changes) {
      const layer = editor.layers.find(change.id)
      if (layer) restoreTransform(layer, change[state])
    }
    editor.markDocumentChanged()
  }
}

export class SetObjectAspectLockCommand implements Command {
  readonly label = 'Lock Object Aspect Ratio'
  private before: boolean | undefined
  constructor(
    private id: string,
    private after: boolean,
  ) {}
  execute(editor: EditorCore): void {
    const layer = editor.layers.find(this.id)
    if (!layer || layer.locked) return
    this.before = layer.aspectRatioLocked
    layer.aspectRatioLocked = this.after
    editor.markDocumentChanged()
  }
  undo(editor: EditorCore): void {
    const layer = editor.layers.find(this.id)
    if (!layer) return
    if (this.before === undefined) delete layer.aspectRatioLocked
    else layer.aspectRatioLocked = this.before
    editor.markDocumentChanged()
  }
}
