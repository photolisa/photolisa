import type { Command } from './Command'
import type { EditorCore } from '../EditorCore'
import { EditorDocument } from '../model/EditorDocument'
import type { ImportedDocumentOptions } from '../model/types'

export class ImportImageCommand implements Command {
  readonly label = 'Import Image'
  private readonly document: EditorDocument
  private previousDocument: EditorDocument | null = null

  constructor(options: ImportedDocumentOptions) {
    this.document = EditorDocument.createFromImage(options)
  }

  execute(editor: EditorCore): void {
    this.previousDocument = editor.document
    editor.setDocument(this.document)
  }

  undo(editor: EditorCore): void {
    editor.setDocument(this.previousDocument)
  }
}
