import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { NativeAsset, NativeProjectManifest } from '../adapters/NativeProjectFormat'

export interface ProjectSummary { id: string; name: string; updatedAt: number; autosave: boolean }
export interface StoredProject extends ProjectSummary { manifest: NativeProjectManifest }
interface PhotolisaDatabase extends DBSchema {
  projects: { key: string; value: StoredProject; indexes: { updatedAt: number } }
  assets: { key: [string, string]; value: { projectId: string; assetId: string; bytes: Uint8Array; mimeType: 'image/png'; width: number; height: number }; indexes: { projectId: string } }
}
export interface ProjectStorage {
  list(): Promise<ProjectSummary[]>
  save(manifest: NativeProjectManifest, assets: readonly NativeAsset[], autosave?: boolean): Promise<void>
  load(id: string): Promise<{ manifest: NativeProjectManifest; assets: NativeAsset[] } | null>
  remove(id: string): Promise<void>
}
export class BrowserProjectStorage implements ProjectStorage {
  private database: Promise<IDBPDatabase<PhotolisaDatabase>> | undefined = undefined
  constructor(private readonly databaseName = 'photolisa-projects-v2') {}
  async list(): Promise<ProjectSummary[]> {
    const rows = await (await this.open()).getAll('projects')
    return rows.map(({ id, name, updatedAt, autosave }) => ({ id, name, updatedAt, autosave })).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  async save(manifest: NativeProjectManifest, assets: readonly NativeAsset[], autosave = false): Promise<void> {
    const db = await this.open(); const tx = db.transaction(['projects', 'assets'], 'readwrite'); const id = manifest.document.id
    for (const key of await tx.objectStore('assets').index('projectId').getAllKeys(id)) await tx.objectStore('assets').delete(key)
    await tx.objectStore('projects').put({ id, name: manifest.document.name, updatedAt: Date.now(), autosave, manifest: structuredClone(manifest) })
    for (const asset of assets) await tx.objectStore('assets').put({ projectId: id, assetId: asset.id, bytes: asset.bytes.slice(), mimeType: asset.mimeType, width: asset.width, height: asset.height })
    await tx.done
  }
  async load(id: string): Promise<{ manifest: NativeProjectManifest; assets: NativeAsset[] } | null> {
    const db = await this.open(); const project = await db.get('projects', id); if (!project) return null
    const rows = await db.getAllFromIndex('assets', 'projectId', id)
    return { manifest: structuredClone(project.manifest), assets: rows.map((row) => ({ id: row.assetId, mimeType: row.mimeType, width: row.width, height: row.height, bytes: row.bytes.slice() })) }
  }
  async remove(id: string): Promise<void> {
    const db = await this.open(); const tx = db.transaction(['projects', 'assets'], 'readwrite')
    for (const key of await tx.objectStore('assets').index('projectId').getAllKeys(id)) await tx.objectStore('assets').delete(key)
    await tx.objectStore('projects').delete(id); await tx.done
  }
  async destroyDatabaseForTests(): Promise<void> { this.database = undefined; await deleteDB(this.databaseName) }
  private open(): Promise<IDBPDatabase<PhotolisaDatabase>> {
    if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is not available in this browser'))
    return this.database ??= openDB<PhotolisaDatabase>(this.databaseName, 1, { upgrade(db) {
      const projects = db.createObjectStore('projects', { keyPath: 'id' }); projects.createIndex('updatedAt', 'updatedAt')
      const assets = db.createObjectStore('assets', { keyPath: ['projectId', 'assetId'] }); assets.createIndex('projectId', 'projectId')
    } }).catch((error: unknown) => { this.database = undefined; throw error })
  }
}
