import { describe, expect, it, vi } from 'vitest'
import { CreateDocumentCommand } from '../../src/core/commands/CreateDocumentCommand'
import { EditorCore } from '../../src/core/EditorCore'

const options = { name: 'Test', width: 640, height: 480, resolution: 72, background: 'white' as const }

describe('EditorCore command history', () => {
  it('executes, undoes, and redoes document creation', () => {
    const editor = new EditorCore()
    const changed = vi.fn()
    editor.events.on('document:changed', changed)

    editor.execute(new CreateDocumentCommand(options))
    const created = editor.document
    expect(created?.name).toBe('Test')
    expect(editor.history.canUndo).toBe(true)

    editor.undo()
    expect(editor.document).toBeNull()
    expect(editor.history.canRedo).toBe(true)

    editor.redo()
    expect(editor.document).toBe(created)
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('clears redo history after a new command', () => {
    const editor = new EditorCore()
    editor.execute(new CreateDocumentCommand(options))
    editor.undo()
    editor.execute(new CreateDocumentCommand({ ...options, name: 'Replacement' }))
    expect(editor.history.canRedo).toBe(false)
  })

  it('does not mark the project unsaved when only the active layer selection changes', () => {
    const editor = new EditorCore()
    editor.execute(new CreateDocumentCommand(options))
    editor.markSaved()
    const id = editor.document?.layers[0]?.id
    if (!id) throw new Error('Test layer missing')
    editor.layers.select(id, 'replace')
    expect(editor.isDirty).toBe(false)
  })
})
