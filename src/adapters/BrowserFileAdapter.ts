interface FilePickerAcceptType { description?: string; accept: Record<string, string[]> }
interface PickerWindow extends Window {
  showOpenFilePicker?: (options: { multiple: false; types: FilePickerAcceptType[] }) => Promise<Array<{ getFile(): Promise<File> }>>
  showSaveFilePicker?: (options: { suggestedName: string; types: FilePickerAcceptType[] }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>
}

type WritableHandle = { createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }
export type SaveDestination = { kind: 'handle'; handle: WritableHandle } | { kind: 'download' } | { kind: 'cancelled' }

export async function pickEditorFile(fallback: HTMLInputElement): Promise<File | null> {
  const picker = (window as PickerWindow).showOpenFilePicker
  if (!picker) { fallback.click(); return null }
  try {
    const [handle] = await picker({ multiple: false, types: [{ description: 'Photolisa, PDF, PSD, SVG, ICO or image', accept: { 'application/pdf': ['.pdf'], 'application/x-photolisa': ['.photolisa'], 'image/vnd.adobe.photoshop': ['.psd'], 'image/svg+xml': ['.svg'], 'image/x-icon': ['.ico'], 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'] } }] })
    return handle ? await handle.getFile() : null
  } catch (error) { if ((error as DOMException).name === 'AbortError') return null; throw error }
}

/** Call before an asynchronous raster encode, while the click still has user activation. */
export async function requestSaveDestination(suggestedName: string, description: string, extension: string, mimeType: string): Promise<SaveDestination> {
  const picker = (window as PickerWindow).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: [{ description, accept: { [mimeType]: [extension] } }] })
      return { kind: 'handle', handle }
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return { kind: 'cancelled' }
      if ((error as DOMException).name === 'SecurityError' || (error as DOMException).name === 'NotAllowedError') return { kind: 'download' }
      throw error
    }
  }
  return { kind: 'download' }
}

export async function saveEditorFile(blob: Blob, suggestedName: string, destination: SaveDestination = { kind: 'download' }): Promise<boolean> {
  if (destination.kind === 'cancelled') return false
  if (destination.kind === 'handle') {
    const writable = await destination.handle.createWritable(); await writable.write(blob); await writable.close(); return true
  }
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = suggestedName; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
