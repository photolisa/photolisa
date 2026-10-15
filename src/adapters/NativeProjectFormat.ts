import type { SerializedEditorDocument } from '../core/model/types'
import { FILE_LIMITS } from './FileSafety'

const MAGIC = new Uint8Array([0x50, 0x48, 0x4f, 0x54, 0x4f, 0x4c, 0x49, 0x53, 0x41, 0x00]) // PHOTOLISA\0
const HEADER_BYTES = MAGIC.length + 4

export interface NativeAssetDescriptor {
  id: string
  mimeType: 'image/png'
  width: number
  height: number
  offset: number
  length: number
}

export interface NativeProjectManifest {
  format: 'photolisa-project'
  version: 1
  application: { name: 'Photolisa'; version: string }
  document: SerializedEditorDocument
  assets: NativeAssetDescriptor[]
}

export interface NativeAsset { id: string; mimeType: 'image/png'; width: number; height: number; bytes: Uint8Array }

export function packNativeProject(document: SerializedEditorDocument, assets: readonly NativeAsset[]): Uint8Array {
  const manifest = createNativeManifest(document, assets)
  const offset = manifest.assets.reduce((total, asset) => total + asset.length, 0)
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  if (manifestBytes.byteLength > FILE_LIMITS.maxManifestBytes) throw new Error('Project manifest is too large')
  const output = new Uint8Array(HEADER_BYTES + manifestBytes.byteLength + offset)
  output.set(MAGIC)
  new DataView(output.buffer).setUint32(MAGIC.length, manifestBytes.byteLength, true)
  output.set(manifestBytes, HEADER_BYTES)
  let cursor = HEADER_BYTES + manifestBytes.byteLength
  for (const asset of assets) { output.set(asset.bytes, cursor); cursor += asset.bytes.byteLength }
  return output
}

export function createNativeManifest(document: SerializedEditorDocument, assets: readonly NativeAsset[]): NativeProjectManifest {
  const descriptors: NativeAssetDescriptor[] = []; let offset = 0
  for (const asset of assets) {
    if (asset.bytes.byteLength === 0) throw new Error(`Asset ${asset.id} is empty`)
    descriptors.push({ id: asset.id, mimeType: asset.mimeType, width: asset.width, height: asset.height, offset, length: asset.bytes.byteLength })
    offset += asset.bytes.byteLength
    if (offset > FILE_LIMITS.maxFileBytes) throw new Error('Project assets exceed the file safety limit')
  }
  return { format: 'photolisa-project', version: 1, application: { name: 'Photolisa', version: '0.1.0' }, document, assets: descriptors }
}

export function unpackNativeProject(input: ArrayBuffer | Uint8Array): { manifest: NativeProjectManifest; assets: Map<string, Uint8Array> } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength < HEADER_BYTES || bytes.byteLength > FILE_LIMITS.maxFileBytes) throw new Error('Invalid or oversized Photolisa project')
  if (!MAGIC.every((value, index) => bytes[index] === value)) throw new Error('Not a Photolisa project file')
  const manifestLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length, true)
  if (manifestLength < 2 || manifestLength > FILE_LIMITS.maxManifestBytes || HEADER_BYTES + manifestLength > bytes.byteLength)
    throw new Error('Invalid Photolisa project manifest length')
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + manifestLength))) } catch { throw new Error('Photolisa project manifest is not valid JSON') }
  assertManifest(parsed)
  const payloadStart = HEADER_BYTES + manifestLength
  const assets = new Map<string, Uint8Array>()
  const ranges: Array<[number, number]> = []
  for (const descriptor of parsed.assets) {
    const start = payloadStart + descriptor.offset
    const end = start + descriptor.length
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < payloadStart || end > bytes.byteLength || descriptor.length < 1)
      throw new Error(`Asset ${descriptor.id} has invalid bounds`)
    if (ranges.some(([a, b]) => start < b && end > a)) throw new Error('Project assets overlap')
    if (assets.has(descriptor.id)) throw new Error(`Duplicate project asset: ${descriptor.id}`)
    ranges.push([start, end])
    assets.set(descriptor.id, bytes.slice(start, end))
  }
  return { manifest: parsed, assets }
}

function assertManifest(value: unknown): asserts value is NativeProjectManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid Photolisa project manifest')
  const manifest = value as Partial<NativeProjectManifest>
  if (manifest.format !== 'photolisa-project' || manifest.version !== 1 || !manifest.document || !Array.isArray(manifest.assets))
    throw new Error('Unsupported Photolisa project format')
  if (manifest.assets.length > FILE_LIMITS.maxLayers * 2) throw new Error('Project contains too many assets')
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.id !== 'string' || asset.mimeType !== 'image/png' || !Number.isSafeInteger(asset.offset) || !Number.isSafeInteger(asset.length))
      throw new Error('Invalid project asset descriptor')
  }
}
