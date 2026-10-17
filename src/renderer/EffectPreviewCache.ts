import { ImageExportAdapter } from '../adapters/ImageExportAdapter'
import type { Layer } from '../core/model/types'
import type { RasterSourceRegistry } from '../raster/RasterSourceRegistry'

interface Entry { key: string; sourceId: string; bytes: number }
interface Job { key: string; layer: Layer; width: number; height: number }
/** Coalesces slider requests per layer, processes off-thread, discards stale completions. */
export class EffectPreviewCache {
  private readonly exporter: ImageExportAdapter
  private readonly entries = new Map<string, Entry>()
  private readonly desired = new Map<string, string>()
  private readonly queued = new Map<string, Job>()
  private running = false
  private destroyed = false
  private bytes = 0
  private readonly budget = 128 * 1024 * 1024
  constructor(private readonly sources: RasterSourceRegistry, private readonly refresh: () => void, private readonly error: (message: string) => void, private readonly busy: (value: boolean) => void) {
    this.exporter = new ImageExportAdapter(sources)
  }
  get(layer: Layer, width: number, height: number): string | null {
    const key = JSON.stringify([width, height, layer, revisions(layer, this.sources)])
    this.desired.set(layer.id, key)
    const entry = this.entries.get(layer.id)
    if (entry?.key === key) { this.entries.delete(layer.id); this.entries.set(layer.id, entry); return entry.sourceId }
    this.queued.set(layer.id, { key, layer: structuredClone(layer), width, height })
    void this.drain()
    return null
  }
  invalidate(): void {
    this.desired.clear(); this.queued.clear()
    for (const entry of this.entries.values()) this.sources.remove(entry.sourceId)
    this.entries.clear(); this.bytes = 0
    this.exporter.clearCache()
  }
  destroy(): void { this.destroyed = true; this.invalidate(); this.exporter.destroy() }
  private async drain(): Promise<void> {
    if (this.running || this.destroyed) return
    this.running = true; this.busy(true)
    try {
      while (this.queued.size && !this.destroyed) {
        const [id, job] = this.queued.entries().next().value as [string, Job]
        this.queued.delete(id)
        if (this.entries.get(id)?.key === job.key) continue
        try {
          const canvas = await this.exporter.renderEffectLayer(job.layer, job.width, job.height)
          if (this.destroyed || this.desired.get(id) !== job.key) continue
          const old = this.entries.get(id)
          if (old) { this.sources.remove(old.sourceId); this.bytes -= old.bytes; this.entries.delete(id) }
          const bytes = canvas.width * canvas.height * 4
          while (this.entries.size && this.bytes + bytes > this.budget) {
            const oldest = this.entries.entries().next().value as [string, Entry]
            this.sources.remove(oldest[1].sourceId); this.bytes -= oldest[1].bytes; this.entries.delete(oldest[0])
          }
          const sourceId = this.sources.registerCanvas(canvas)
          this.entries.set(id, { key: job.key, sourceId, bytes }); this.bytes += bytes
          this.refresh()
        } catch (reason) {
          if (this.desired.get(id) === job.key && !this.destroyed) this.error(reason instanceof Error ? reason.message : 'Effect preview failed')
        }
      }
    } finally { this.running = false; this.busy(false) }
  }
}
function revisions(layer: Layer, sources: RasterSourceRegistry): unknown {
  return layer.kind === 'group' ? layer.children.map(child => revisions(child, sources)) : layer.kind === 'raster' ? [layer.pixelSourceId ? sources.get(layer.pixelSourceId)?.revision : 0, layer.mask ? sources.get(layer.mask.pixelSourceId)?.revision : 0] : null
}
