import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const eps = (pixels: string) => `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 2 2\n%%PhotolisaRGB: 2 2\n%%EndComments\n2 2 scale\n2 2 8 [2 0 0 -2 0 2]\ncurrentfile /ASCIIHexDecode filter false 3 colorimage\n${pixels}\n>\n%%EOF\n`

async function pngPixels(page: import('@playwright/test').Page, bytes: Buffer): Promise<number[]> {
  return page.evaluate(async (values) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(values)], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0); bitmap.close()
    return [...context.getImageData(0, 0, canvas.width, canvas.height).data]
  }, [...bytes])
}

test('opens passive EPS RGB data and exports a valid flattened EPS round trip', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.locator('input[type=file]').setInputFiles({ name: 'colors.eps', mimeType: 'application/postscript', buffer: Buffer.from(eps('FF0000 00FF00\n0000FF FFFFFF')) })
  await expect(page.getByText('colors', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/one raster layer/)).toBeVisible()

  await page.getByRole('button', { name: 'File' }).click()
  const epsDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export EPS (flattened)…' }).click()
  const epsPath = await (await epsDownload).path()
  if (!epsPath) throw new Error('EPS download unavailable')
  const exported = await readFile(epsPath)
  expect(exported.toString('latin1')).toContain('%%PhotolisaRGB: 2 2')
  expect(exported.toString('latin1')).toContain('FF000000FF00')
  const ghostscript = spawnSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dEPSCrop', '-sDEVICE=ppmraw', '-r72', '-sOutputFile=-', '-'], { input: exported })
  if (!ghostscript.error || (ghostscript.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    expect(ghostscript.status, ghostscript.stderr?.toString()).toBe(0)
    expect(ghostscript.stdout.toString('latin1')).toContain('P6')
    expect(ghostscript.stdout.includes(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]))).toBe(true)
  }
  await expect(page.getByText(/transparency is composited onto white/)).toBeVisible()

  await page.locator('input[type=file]').setInputFiles({ name: 'roundtrip.eps', mimeType: 'application/postscript', buffer: exported })
  await expect(page.getByText('roundtrip', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'File' }).click()
  const pngDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG…' }).click()
  const pngPath = await (await pngDownload).path()
  if (!pngPath) throw new Error('PNG download unavailable')
  const png = await readFile(pngPath)
  expect(await pngPixels(page, png)).toEqual([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ])
})

test('imports a standard EPSI preview and rejects EPS without one', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const preview = `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 2 1\n%%EndComments\n%%BeginPreview: 2 1 1 1\n% 80\n%%EndPreview\nnewpath 0 0 moveto 2 1 lineto stroke\n%%EOF\n`
  await page.locator('input[type=file]').setInputFiles({ name: 'preview.epsi', mimeType: 'application/postscript', buffer: Buffer.from(preview) })
  await expect(page.getByText('preview', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/embedded screen preview/)).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: 'no-preview.eps', mimeType: 'application/postscript', buffer: Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 1 1\nshowpage\n') })
  await expect(page.getByRole('alert').getByText(/no supported embedded preview/)).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: 'oversized.eps', mimeType: 'application/postscript', buffer: Buffer.from(eps('').replace('%%PhotolisaRGB: 2 2', '%%PhotolisaRGB: 999999 1')) })
  await expect(page.getByRole('alert').getByText(/dimension limit/)).toBeVisible()
})

test('EPS export composites transparent pixels onto white', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = 'rgba(255, 0, 0, 0.5)'; context.fillRect(0, 0, 1, 1)
    return [...new Uint8Array(await (await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))).arrayBuffer())]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'alpha.png', mimeType: 'image/png', buffer: Buffer.from(png) })
  await expect(page.getByText('alpha', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'File' }).click()
  const epsDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export EPS (flattened)…' }).click()
  const path = await (await epsDownload).path()
  if (!path) throw new Error('EPS download unavailable')
  const output = (await readFile(path)).toString('latin1')
  expect(output).toMatch(/FF7F7F\s*FFFFFF|FF8080\s*FFFFFF/)
})
