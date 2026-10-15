import { ref } from 'vue'
import { ImageImportAdapter } from '~/adapters/ImageImportAdapter'
import type { ImportedDocumentOptions } from '~/core/model/types'
import { rasterSources } from '~/raster/RasterSourceRegistry'

export function useImageImport(importDocument: (options: ImportedDocumentOptions) => void) {
  const adapter = new ImageImportAdapter()
  const importing = ref(false)
  const importError = ref<string | null>(null)

  async function importFile(file: File): Promise<boolean> {
    if (importing.value) return false
    importing.value = true
    importError.value = null
    try {
      const decoded = await adapter.decode(file)
      const pixelSourceId = rasterSources.register(decoded.bitmap)
      try {
        importDocument({
          name: decoded.name,
          width: decoded.width,
          height: decoded.height,
          resolution: 72,
          pixelSourceId,
        })
      } catch (error) {
        rasterSources.remove(pixelSourceId)
        throw error
      }
      return true
    } catch (error) {
      importError.value = error instanceof Error ? error.message : 'The image could not be imported.'
      return false
    } finally {
      importing.value = false
    }
  }

  return { importing, importError, importFile, clearImportError: () => { importError.value = null } }
}
