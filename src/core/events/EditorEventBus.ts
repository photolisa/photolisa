import type { EditorEvent, EditorEventMap } from './events'

type Listener<K extends EditorEvent> = (payload: EditorEventMap[K]) => void

export class EditorEventBus {
  private readonly listeners = new Map<EditorEvent, Set<(payload: unknown) => void>>()

  on<K extends EditorEvent>(event: K, listener: Listener<K>): () => void {
    const eventListeners = this.listeners.get(event) ?? new Set()
    eventListeners.add(listener as (payload: unknown) => void)
    this.listeners.set(event, eventListeners)
    return () => eventListeners.delete(listener as (payload: unknown) => void)
  }

  emit<K extends EditorEvent>(event: K, payload: EditorEventMap[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload))
  }

  clear(): void {
    this.listeners.clear()
  }
}
