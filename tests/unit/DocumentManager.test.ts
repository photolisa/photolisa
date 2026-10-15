import { describe, expect, it } from 'vitest'
import { DocumentManager } from '../../src/core/DocumentManager'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { AddEmptyLayerCommand } from '../../src/core/commands/LayerCommands'
import { SelectionMask } from '../../src/core/selection/SelectionMask'

const makeDocument = (name: string) => EditorDocument.create({ name, width: 320, height: 240, resolution: 72, background: 'transparent' })

describe('DocumentManager', () => {
  it('keeps independent editor instances, histories, tools, views and selections across switches', () => {
    const manager = new DocumentManager()
    const first = manager.open(makeDocument('First'))
    first.editor.execute(new AddEmptyLayerCommand())
    manager.setTool(first.id, 'brush')
    manager.setView(first.id, { zoom: 2, origin: { x: 11, y: 17 }, center: { x: 80, y: 50 } })
    first.editor.setSelection(SelectionMask.rectangle(320, 240, { x: 1, y: 2, width: 10, height: 20 }))
    const second = manager.open(makeDocument('Second'))
    second.editor.execute(new AddEmptyLayerCommand())
    second.editor.undo()
    manager.setTool(second.id, 'marquee')
    manager.activate(first.id)
    expect(manager.active?.editor).toBe(first.editor)
    expect(first.editor.document?.layers).toHaveLength(2)
    expect(first.editor.history.canUndo).toBe(true)
    expect(first.tool).toBe('brush')
    expect(first.view?.zoom).toBe(2)
    expect(first.editor.selection?.outlineBounds?.width).toBe(10)
    expect(second.editor.selection).toBeNull()
    expect(second.editor.document?.layers).toHaveLength(1)
    expect(second.editor.history.canRedo).toBe(true)
    manager.destroy()
  })

  it('reorders, closes and reopens the same session and cycles tabs', () => {
    const manager = new DocumentManager(2)
    const first = manager.open(makeDocument('First'))
    const second = manager.open(makeDocument('Second'))
    const third = manager.open(makeDocument('Third'))
    manager.reorder(first.id, third.id, true)
    expect(manager.tabs.map((tab) => tab.id)).toEqual([second.id, third.id, first.id])
    manager.cycle(-1)
    expect(manager.active?.id).toBe(second.id)
    manager.close(second.id)
    expect(manager.active?.id).toBe(third.id)
    expect(manager.canReopen).toBe(true)
    expect(manager.reopenLastClosed()).toBe(second)
    expect(manager.active?.editor).toBe(second.editor)
    manager.destroy()
  })
})
