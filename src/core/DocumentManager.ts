import { EditorCore } from './EditorCore'
import { EditorDocument } from './model/EditorDocument'

export type EditorToolId = 'move' | 'brush' | 'pencil' | 'eraser' | 'paint-bucket' | 'clone-stamp' | 'spot-repair' | 'text' | 'crop' | 'marquee' | 'ellipse-marquee' | 'lasso' | 'hand' | 'zoom' | 'transform' | 'eyedropper' | 'rectangle' | 'rounded-rectangle' | 'circle' | 'ellipse' | 'hexagon' | 'line' | 'polygon' | 'triangle' | 'star' | 'arrow' | 'custom-shape' | 'pen' | 'curvature-pen' | 'freeform-pen' | 'path-selection' | 'direct-selection'
export interface DocumentView { zoom: number; origin: { x: number; y: number }; center: { x: number; y: number } }

export interface DocumentSession {
  readonly id: string
  readonly editor: EditorCore
  tool: EditorToolId
  view: DocumentView | null
}

export interface DocumentTab {
  id: string
  name: string
  dirty: boolean
  active: boolean
}

interface ClosedSession { session: DocumentSession; index: number }

/** Owns persistent per-project cores; switching never recreates a document or its history. */
export class DocumentManager {
  private readonly sessions: DocumentSession[] = []
  private readonly recentlyClosed: ClosedSession[] = []
  private readonly listeners = new Set<() => void>()
  private readonly disposers = new Map<string, Array<() => void>>()
  private activeId: string | null = null

  constructor(private readonly maxRecentlyClosed = 5) {
    if (!Number.isInteger(maxRecentlyClosed) || maxRecentlyClosed < 0) throw new Error('Recently closed limit must be a nonnegative integer')
  }

  get active(): DocumentSession | null { return this.sessions.find((session) => session.id === this.activeId) ?? null }
  get count(): number { return this.sessions.length }
  get canReopen(): boolean { return this.recentlyClosed.length > 0 }
  get hasDirty(): boolean { return this.sessions.some((session) => session.editor.isDirty) }
  get tabs(): DocumentTab[] { return this.sessions.map((session) => ({ id: session.id, name: session.editor.document?.name ?? 'Untitled', dirty: session.editor.isDirty, active: session.id === this.activeId })) }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  find(id: string): DocumentSession | null { return this.sessions.find((session) => session.id === id) ?? null }

  open(document: EditorDocument, options: { dirty?: boolean } = {}): DocumentSession {
    const existing = this.find(document.id)
    if (existing) { this.activate(existing.id); return existing }
    const closedIndex = this.recentlyClosed.findIndex(({ session }) => session.id === document.id)
    if (closedIndex >= 0) this.disposeSession(this.recentlyClosed.splice(closedIndex, 1)[0]!.session)
    const editor = new EditorCore()
    editor.setDocument(document)
    if (options.dirty) editor.markDocumentChanged()
    const session: DocumentSession = { id: document.id, editor, tool: 'move', view: null }
    this.observe(session)
    this.sessions.push(session)
    this.activeId = session.id
    this.notify()
    return session
  }

  activate(id: string): boolean {
    if (!this.find(id)) return false
    if (this.activeId === id) return true
    this.activeId = id
    this.notify()
    return true
  }

  cycle(direction: 1 | -1): DocumentSession | null {
    if (!this.sessions.length) return null
    const index = this.sessions.findIndex((session) => session.id === this.activeId)
    const next = (index + direction + this.sessions.length) % this.sessions.length
    const session = this.sessions[next]!
    this.activate(session.id)
    return session
  }

  reorder(sourceId: string, targetId: string, after = false): boolean {
    const sourceIndex = this.sessions.findIndex((session) => session.id === sourceId)
    const targetIndex = this.sessions.findIndex((session) => session.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false
    const [session] = this.sessions.splice(sourceIndex, 1)
    const nextTarget = this.sessions.findIndex((item) => item.id === targetId)
    this.sessions.splice(nextTarget + Number(after), 0, session!)
    this.notify()
    return true
  }

  /** Caller confirms unsaved changes before closing. */
  close(id: string): boolean {
    const index = this.sessions.findIndex((session) => session.id === id)
    if (index < 0) return false
    const [session] = this.sessions.splice(index, 1)
    this.recentlyClosed.push({ session: session!, index })
    while (this.recentlyClosed.length > this.maxRecentlyClosed) this.disposeSession(this.recentlyClosed.shift()!.session)
    if (this.activeId === id) this.activeId = this.sessions[Math.min(index, this.sessions.length - 1)]?.id ?? null
    this.notify()
    return true
  }

  reopenLastClosed(): DocumentSession | null {
    const closed = this.recentlyClosed.pop()
    if (!closed) return null
    this.sessions.splice(Math.min(closed.index, this.sessions.length), 0, closed.session)
    this.activeId = closed.session.id
    this.notify()
    return closed.session
  }

  setTool(id: string, tool: EditorToolId): void { const session = this.find(id); if (session) session.tool = tool }
  setView(id: string, view: DocumentView): void { const session = this.find(id); if (session) session.view = { zoom: view.zoom, origin: { ...view.origin }, center: { ...view.center } } }

  destroy(): void {
    for (const session of this.sessions) this.disposeSession(session)
    for (const { session } of this.recentlyClosed) this.disposeSession(session)
    this.sessions.length = 0; this.recentlyClosed.length = 0; this.activeId = null
    this.listeners.clear()
  }

  private observe(session: DocumentSession): void {
    this.disposers.set(session.id, [
      session.editor.events.on('document:changed', () => this.notify()),
      session.editor.events.on('dirty:changed', () => this.notify()),
    ])
  }

  private disposeSession(session: DocumentSession): void {
    this.disposers.get(session.id)?.forEach((stop) => stop())
    this.disposers.delete(session.id)
    session.editor.destroy()
  }

  private notify(): void { this.listeners.forEach((listener) => listener()) }
}
