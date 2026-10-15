import type { Command } from './Command'
import type { EditorCore } from '../EditorCore'

export interface HistoryOptions { maxEntries: number; maxMemoryBytes: number }
const DEFAULT_OPTIONS: HistoryOptions = { maxEntries: 100, maxMemoryBytes: 256 * 1024 * 1024 }

export class CommandHistory {
  private readonly undoStack: Command[] = []
  private readonly redoStack: Command[] = []
  private transaction: { label: string; commands: Command[] } | null = null
  private options: HistoryOptions
  private memoryBytes = 0

  constructor(options: Partial<HistoryOptions> = {}) { this.options = validateOptions({ ...DEFAULT_OPTIONS, ...options }) }

  configure(options: Partial<HistoryOptions>): void {
    this.options = validateOptions({ ...this.options, ...options })
    this.enforceLimits()
  }

  execute(command: Command, editor: EditorCore): void { command.execute(editor); this.record(command) }
  commitExecuted(command: Command): void { this.record(command) }

  beginTransaction(label: string): void {
    if (this.transaction) throw new Error('A history transaction is already active')
    this.transaction = { label, commands: [] }
  }

  commitTransaction(): void {
    const transaction = this.transaction
    if (!transaction) throw new Error('No history transaction is active')
    this.transaction = null
    if (transaction.commands.length) this.pushUndo(new TransactionCommand(transaction.label, transaction.commands))
  }

  cancelTransaction(editor: EditorCore): void {
    const transaction = this.transaction
    if (!transaction) return
    this.transaction = null
    for (let index = transaction.commands.length - 1; index >= 0; index -= 1) transaction.commands[index]?.undo(editor)
    transaction.commands.forEach((command) => command.dispose?.())
  }

  undo(editor: EditorCore): Command | undefined {
    if (this.transaction) throw new Error('Cannot undo during a history transaction')
    const command = this.undoStack.pop()
    if (!command) return undefined
    command.undo(editor)
    this.redoStack.push(command)
    return command
  }

  redo(editor: EditorCore): Command | undefined {
    if (this.transaction) throw new Error('Cannot redo during a history transaction')
    const command = this.redoStack.pop()
    if (!command) return undefined
    command.execute(editor)
    this.undoStack.push(command)
    this.enforceLimits()
    return command
  }

  clear(): void {
    this.undoStack.forEach((command) => command.dispose?.())
    this.redoStack.forEach((command) => command.dispose?.())
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.memoryBytes = 0
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  get estimatedMemoryBytes(): number { return this.memoryBytes }
  get retainedEntries(): number { return this.undoStack.length + this.redoStack.length }

  private record(command: Command): void {
    if (this.transaction) this.transaction.commands.push(command)
    else this.pushUndo(command)
  }

  private pushUndo(command: Command): void {
    this.redoStack.forEach((item) => {
      this.memoryBytes -= costOf(item)
      item.dispose?.()
    })
    this.redoStack.length = 0
    this.undoStack.push(command)
    this.memoryBytes += costOf(command)
    this.enforceLimits()
  }

  private enforceLimits(): void {
    while (this.undoStack.length + this.redoStack.length > this.options.maxEntries || this.memoryBytes > this.options.maxMemoryBytes) {
      // Keep the next redo command intact and discard the furthest future entry first.
      const evicted = this.undoStack.shift() ?? this.redoStack.shift()
      if (!evicted) break
      this.memoryBytes -= costOf(evicted)
      evicted.dispose?.()
    }
  }
}

class TransactionCommand implements Command {
  readonly memoryCost: number
  readonly affectsDocument: boolean
  constructor(readonly label: string, private readonly commands: readonly Command[]) {
    this.memoryCost = commands.reduce((total, command) => total + costOf(command), 0)
    this.affectsDocument = commands.some((command) => command.affectsDocument !== false)
  }
  execute(editor: EditorCore): void { this.commands.forEach((command) => command.execute(editor)) }
  undo(editor: EditorCore): void {
    for (let index = this.commands.length - 1; index >= 0; index -= 1) this.commands[index]?.undo(editor)
  }
  dispose(): void { this.commands.forEach((command) => command.dispose?.()) }
}

function costOf(command: Command): number { return Math.max(0, command.memoryCost ?? 256) }

function validateOptions(options: HistoryOptions): HistoryOptions {
  if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1) throw new Error('History maxEntries must be a positive integer')
  if (!Number.isSafeInteger(options.maxMemoryBytes) || options.maxMemoryBytes < 1) throw new Error('History maxMemoryBytes must be a positive integer')
  return options
}
