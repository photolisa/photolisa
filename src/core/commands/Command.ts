import type { EditorCore } from '../EditorCore'

export interface Command {
  readonly label: string
  readonly memoryCost?: number
  readonly affectsDocument?: boolean
  execute(editor: EditorCore): void
  undo(editor: EditorCore): void
  dispose?(): void
}
