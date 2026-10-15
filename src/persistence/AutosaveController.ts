import type { EditorCore } from '../core/EditorCore'
import { NativeProjectAdapter, StaleProjectSnapshotError } from '../adapters/NativeProjectAdapter'
import { createNativeManifest } from '../adapters/NativeProjectFormat'
import { BrowserProjectStorage } from './ProjectStorage'

export class AutosaveController {
  private timer: ReturnType<typeof setTimeout> | undefined
  private stop: (() => void) | undefined = undefined
  private saving: Promise<void> | null = null
  private retryDelayMs = 2_000
  private destroyed = false
  constructor(
    private readonly editor: EditorCore,
    private readonly adapter = new NativeProjectAdapter(),
    private readonly storage = new BrowserProjectStorage(),
    private readonly delayMs = 2_000,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {}
  start(): void {
    if (this.stop) return
    this.destroyed = false
    this.stop = this.editor.events.on('document:changed', () => this.schedule())
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.addEventListener('pagehide', this.onPageHide)
  }
  schedule(): void {
    if (this.destroyed) return
    if (this.timer) clearTimeout(this.timer)
    this.queueSave(this.delayMs)
  }
  async saveNow(): Promise<void> {
    if (this.saving) return this.saving
    this.saving = this.performSave().finally(() => { this.saving = null })
    return this.saving
  }
  private async performSave(): Promise<void> {
    const document = this.editor.document
    if (!document || !this.editor.isDirty) return
    const revision = document.revision
    const snapshot = await this.adapter.capture(document)
    if (this.editor.document !== document || document.revision !== revision || !this.editor.isDirty) { this.schedule(); return }
    await this.storage.save(createNativeManifest(snapshot.document, snapshot.assets), snapshot.assets, true)
    this.retryDelayMs = 2_000
    if (this.editor.document === document && document.revision !== revision) this.schedule()
  }
  async recover(id: string): Promise<void> {
    const stored = await this.storage.load(id); if (!stored) throw new Error('Recovery project no longer exists')
    for (const descriptor of stored.manifest.assets) if (!stored.assets.some((asset) => asset.id === descriptor.id)) throw new Error(`Missing recovery asset: ${descriptor.id}`)
    // Reuse the same validated restoration path without serializing the container header.
    const restored = await this.adapter.restore({ manifest: stored.manifest, assets: new Map(stored.assets.map((a) => [a.id, a.bytes])) })
    this.editor.setDocument(restored.document); this.editor.markDocumentChanged()
  }
  async recoveries() { return (await this.storage.list()).filter((item) => item.autosave) }
  async discard(documentId: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    await this.saving?.catch(() => undefined)
    await this.storage.remove(documentId)
  }
  destroy(): void {
    this.destroyed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.stop?.(); this.stop = undefined
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.removeEventListener('pagehide', this.onPageHide)
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) void this.saveNow().catch((error: unknown) => this.handleFailure(error))
    else if (this.editor.isDirty) this.schedule()
  }
  private readonly onPageHide = (): void => { void this.saveNow().catch((error: unknown) => this.handleFailure(error)) }

  private queueSave(delay: number): void {
    this.timer = setTimeout(() => { this.timer = undefined; void this.saveNow().catch((error: unknown) => this.handleFailure(error)) }, delay)
  }

  private handleFailure(error: unknown): void {
    if (!(error instanceof StaleProjectSnapshotError)) this.onError(error instanceof Error ? error : new Error('Autosave failed'))
    if (!this.destroyed && this.editor.isDirty) {
      if (this.timer) clearTimeout(this.timer)
      this.queueSave(this.retryDelayMs)
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30_000)
    }
  }
}
