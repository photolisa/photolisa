import type { Command } from './Command'
import type { EditorCore } from '../EditorCore'
import type { SelectionMask } from '../selection/SelectionMask'

/** Selection is session state: it participates in undo/redo but never dirties project pixels. */
export class SetSelectionCommand implements Command {
  readonly affectsDocument = false
  readonly memoryCost: number
  constructor(readonly label: string, private readonly before: SelectionMask | null, private readonly after: SelectionMask | null) {
    this.memoryCost = (before?.memoryCost ?? 0) + (after?.memoryCost ?? 0)
  }
  execute(editor: EditorCore): void { editor.setSelection(this.after) }
  undo(editor: EditorCore): void { editor.setSelection(this.before) }
}
