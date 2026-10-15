import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ColorSnapshot, ColorStorage } from '../core/colors/ColorManager'

interface ColorDatabase extends DBSchema { colors: { key: string; value: ColorSnapshot } }

/** Browser-only adapter; the color domain module itself has no DOM or IndexedDB dependency. */
export class BrowserColorStorage implements ColorStorage {
  private database: Promise<IDBPDatabase<ColorDatabase>> | null = null
  constructor(private readonly databaseName = 'photolisa-colors-v1') {}
  async load(): Promise<ColorSnapshot | null> { return (await (await this.open()).get('colors', 'library')) ?? null }
  async save(snapshot: ColorSnapshot): Promise<void> { await (await this.open()).put('colors', snapshot, 'library') }
  private open(): Promise<IDBPDatabase<ColorDatabase>> {
    if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable'))
    return this.database ??= openDB<ColorDatabase>(this.databaseName, 1, { upgrade(db) { db.createObjectStore('colors') } }).catch((error: unknown) => { this.database = null; throw error })
  }
}
