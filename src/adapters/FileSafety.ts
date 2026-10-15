export const FILE_LIMITS = Object.freeze({
  maxFileBytes: 256 * 1024 * 1024,
  maxDimension: 16_384,
  maxPixels: 100_000_000,
  maxDecodedBytes: 512 * 1024 * 1024,
  maxLayers: 5_000,
  maxManifestBytes: 8 * 1024 * 1024,
})

export function validateRasterBudget(width: number, height: number, label = 'Image'): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new Error(`${label} has invalid dimensions`)
  if (width > FILE_LIMITS.maxDimension || height > FILE_LIMITS.maxDimension)
    throw new Error(`${label} exceeds the ${FILE_LIMITS.maxDimension.toLocaleString()} pixel dimension limit`)
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels > FILE_LIMITS.maxPixels || pixels * 4 > FILE_LIMITS.maxDecodedBytes)
    throw new Error(`${label} exceeds the decoded pixel memory limit`)
}

export function validateFileSize(file: Blob, label = 'File'): void {
  if (file.size < 1) throw new Error(`${label} is empty`)
  if (file.size > FILE_LIMITS.maxFileBytes) throw new Error(`${label} exceeds the 256 MiB file limit`)
}
