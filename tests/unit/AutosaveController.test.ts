// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { AutosaveController } from '../../src/persistence/AutosaveController'
import { BrowserProjectStorage } from '../../src/persistence/ProjectStorage'
import { NativeProjectAdapter, type NativeProjectSnapshot } from '../../src/adapters/NativeProjectAdapter'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'

function setup() {
  const editor = new EditorCore()
  const document = EditorDocument.create({ name: 'Autosave test', width: 8, height: 8, resolution: 72, background: 'transparent' })
  editor.setDocument(document)
  const adapter = new NativeProjectAdapter()
  const storage = new BrowserProjectStorage('autosave-unit-test')
  const save = vi.spyOn(storage, 'save').mockResolvedValue()
  return { editor, document, adapter, storage, save }
}

describe('AutosaveController', () => {
  it('stores a stable snapshot and does not clear the unsaved marker', async () => {
    const { editor, document, adapter, storage, save } = setup()
    vi.spyOn(adapter, 'capture').mockImplementation(async () => ({ document: document.serialize(), assets: [] }))
    const controller = new AutosaveController(editor, adapter, storage, 2_000)
    controller.start()
    editor.markDocumentChanged()
    await controller.saveNow()
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0].document.id).toBe(document.id)
    expect(save.mock.calls[0]?.[2]).toBe(true)
    expect(editor.isDirty).toBe(true)
    controller.destroy()
  })

  it('does not write an outdated snapshot when the document changes during capture', async () => {
    const { editor, document, adapter, storage, save } = setup()
    let resolveCapture!: (snapshot: NativeProjectSnapshot) => void
    vi.spyOn(adapter, 'capture').mockImplementation(() => new Promise((resolve) => { resolveCapture = resolve }))
    const controller = new AutosaveController(editor, adapter, storage, 2_000)
    controller.start()
    editor.markDocumentChanged()
    const pending = controller.saveNow()
    editor.markDocumentChanged()
    resolveCapture({ document: document.serialize(), assets: [] })
    await pending
    expect(save).not.toHaveBeenCalled()
    controller.destroy()
  })
})
