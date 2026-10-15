import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { readPsd, writePsdUint8Array, type Psd } from 'ag-psd'

test('PSD import and export preserve opaque, partial, and transparent layer opacity', async ({ page }) => {
  const pixels = { width: 2, height: 2, data: new Uint8ClampedArray(Array(4).fill([255, 0, 0, 255]).flat()) }
  const fixture: Psd = {
    width: 2, height: 2, imageData: pixels,
    children: [
      { name: 'Opaque', left: 0, top: 0, right: 2, bottom: 2, opacity: 1, imageData: pixels },
      { name: 'Half', left: 0, top: 0, right: 2, bottom: 2, opacity: 0.5, imageData: pixels },
      { name: 'Transparent', left: 0, top: 0, right: 2, bottom: 2, opacity: 0, imageData: pixels },
    ],
  }
  const bytes = writePsdUint8Array(fixture, { generateThumbnail: false })
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.locator('input[type=file]').setInputFiles({ name: 'opacity.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: Buffer.from(bytes) })
  for (const [name, value] of [['Opaque', '100%'], ['Half', '50%'], ['Transparent', '0%']] as const) {
    await page.getByText(name, { exact: true }).click()
    await expect(page.locator('aside').getByText(value, { exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'File' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PSD…' }).click()
  const path = await (await downloadPromise).path()
  if (!path) throw new Error('PSD download unavailable')
  const exported = readPsd(await readFile(path), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true })
  const opacity = new Map(exported.children?.map((layer) => [layer.name, layer.opacity]))
  expect(opacity.get('Opaque')).toBe(1)
  expect(opacity.get('Half')).toBeCloseTo(0.5, 2)
  expect(opacity.get('Transparent')).toBe(0)
})

test('SVG import retains default, group, and explicit shape opacity', async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g id="half" opacity="0.5"><rect id="quarter" width="8" height="8" opacity="0.25"/><circle id="opaque" cx="16" cy="16" r="4"/></g><rect id="default" x="24" width="8" height="8"/></svg>'
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.locator('input[type=file]').setInputFiles({ name: 'opacity.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
  for (const [name, value] of [['default', '100%'], ['half', '50%'], ['quarter', '25%'], ['opaque', '100%']] as const) {
    await page.getByText(name, { exact: true }).click()
    await expect(page.locator('aside').getByText(value, { exact: true })).toBeVisible()
  }
})
