import type { EditorCore } from '../EditorCore'
import type { Command } from './Command'

export class RenameDocumentCommand implements Command {
  readonly label = 'Rename Project'
  private previous: string | null = null
  constructor(private readonly next: string) {}
  execute(editor: EditorCore): void {
    const document = editor.document
    if (!document) throw new Error('No project is open')
    const name = this.next.trim()
    if (!name) throw new Error('Project name cannot be empty')
    this.previous ??= document.name
    document.name = name
    editor.markDocumentChanged()
  }
  undo(editor: EditorCore): void {
    if (!editor.document || this.previous === null) return
    editor.document.name = this.previous
    editor.markDocumentChanged()
  }
}
