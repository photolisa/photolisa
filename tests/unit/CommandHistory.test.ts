import { describe, expect, it, vi } from 'vitest'
import type { Command } from '../../src/core/commands/Command'
import { EditorCore } from '../../src/core/EditorCore'

class ValueCommand implements Command {
  constructor(
    readonly label: string,
    private readonly state: { value: number },
    private readonly delta: number,
    readonly memoryCost = 1,
    readonly dispose = vi.fn(),
  ) {}

  execute(): void { this.state.value += this.delta }
  undo(): void { this.state.value -= this.delta }
}

describe('CommandHistory', () => {
  it('batches related commands into one reversible transaction', () => {
    const editor = new EditorCore()
    const state = { value: 0 }

    editor.beginTransaction('Two edits')
    editor.execute(new ValueCommand('First', state, 2))
    editor.execute(new ValueCommand('Second', state, 3))
    editor.commitTransaction()

    expect(state.value).toBe(5)
    editor.undo()
    expect(state.value).toBe(0)
    editor.redo()
    expect(state.value).toBe(5)
  })

  it('rolls back a cancelled transaction without creating history', () => {
    const editor = new EditorCore()
    const state = { value: 0 }
    editor.beginTransaction('Cancelled edits')
    editor.execute(new ValueCommand('Edit', state, 4))
    editor.cancelTransaction()

    expect(state.value).toBe(0)
    expect(editor.history.canUndo).toBe(false)
  })

  it('bounds retained undo and redo data and disposes evicted commands', () => {
    const editor = new EditorCore()
    const state = { value: 0 }
    editor.history.configure({ maxEntries: 2, maxMemoryBytes: 10 })
    const first = new ValueCommand('First', state, 1, 4)
    const second = new ValueCommand('Second', state, 1, 4)
    const third = new ValueCommand('Third', state, 1, 4)

    editor.execute(first)
    editor.execute(second)
    editor.execute(third)

    expect(first.dispose).toHaveBeenCalledOnce()
    expect(editor.history.estimatedMemoryBytes).toBe(8)
    editor.undo()
    editor.undo()
    expect(editor.history.estimatedMemoryBytes).toBe(8)

    const replacement = new ValueCommand('Replacement', state, 5, 4)
    editor.execute(replacement)
    expect(second.dispose).toHaveBeenCalledOnce()
    expect(third.dispose).toHaveBeenCalledOnce()
    expect(editor.history.estimatedMemoryBytes).toBe(4)
  })

  it('rejects invalid memory budgets', () => {
    const editor = new EditorCore()
    expect(() => editor.history.configure({ maxMemoryBytes: 0 })).toThrow(/positive integer/)
    expect(() => editor.history.configure({ maxEntries: -1 })).toThrow(/positive integer/)
  })
})
