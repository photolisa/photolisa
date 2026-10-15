import type { Command } from './Command'
import type { EditorCore } from '../EditorCore'
import { EditorDocument } from '../model/EditorDocument'
import type { NewDocumentOptions } from '../model/types'

export class CreateDocumentCommand implements Command {
  readonly label = 'New Document'
  private readonly document: EditorDocument
  private previousDocument: EditorDocument | null = null

  constructor(options: NewDocumentOptions) {
    this.document = EditorDocument.create(options)
  }

  execute(editor: EditorCore): void {
    this.previousDocument = editor.document
    editor.setDocument(this.document)
  }

  undo(editor: EditorCore): void {
    editor.setDocument(this.previousDocument)
  }
}
