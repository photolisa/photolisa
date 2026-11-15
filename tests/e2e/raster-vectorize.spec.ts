import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

for (const format of ['png', 'jpeg'] as const) {
  test(`converts an imported ${format.toUpperCase()} raster layer into editable vector paths`, async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
    const pixels = await page.evaluate(async (mime) => {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32
      const context = canvas.getContext('2d')!
      if (mime === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, 32, 32) }
      context.fillStyle = '#ff0000'; context.fillRect(8, 8, 16, 16)
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), mime, 1))
      return [...new Uint8Array(await blob.arrayBuffer())]
    }, format === 'png' ? 'image/png' : 'image/jpeg')
    await page.locator('input[type=file]').setInputFiles({ name: `sample.${format === 'jpeg' ? 'jpg' : 'png'}`, mimeType: `image/${format}`, buffer: Buffer.from(pixels) })
    await expect(page.getByRole('tab', { name: 'sample', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: 'properties', exact: true }).click()
    await page.getByRole('button', { name: 'Vectorize layer (8 colors)' }).click()
    await page.getByRole('button', { name: 'layers', exact: true }).click()
    await expect(page.getByText('sample vector', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'File' }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export SVG…' }).click()
    const svgPath = await (await download).path()
    if (!svgPath) throw new Error('SVG download unavailable')
    const svg = await readFile(svgPath, 'utf8')
    expect(svg).toContain('<path')
    expect(svg).toMatch(/display="none"[^>]*><title>sample<\/title><image/)
    await page.getByRole('button', { name: 'File' }).click()
    const pngDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export PNG…' }).click()
    const pngPath = await (await pngDownload).path()
    if (!pngPath) throw new Error('PNG download unavailable')
    const output = await readFile(pngPath)
    const [center, corner] = await page.evaluate(async (values) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(values)], { type: 'image/png' }))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
      return [[...context.getImageData(16, 16, 1, 1).data], [...context.getImageData(1, 1, 1, 1).data]]
    }, [...output])
    expect(center?.[0]).toBeGreaterThan(240)
    expect(center?.[1]).toBeLessThan(20)
    expect(corner?.[3]).toBe(format === 'png' ? 0 : 255)
    await page.getByText('path', { exact: true }).first().click()
    await expect(page.getByLabel('Vector fill type')).toBeVisible()
    await page.keyboard.press('Control+z')
    await expect(page.getByText('sample vector', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Control+Shift+z')
    await expect(page.getByText('sample vector', { exact: true })).toBeVisible()
    if (format === 'png') {
      await page.evaluate(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }))
      await page.getByRole('button', { name: 'File' }).click()
      const projectDownload = page.waitForEvent('download')
      await page.getByRole('button', { name: /Save project/ }).click()
      const projectPath = await (await projectDownload).path()
      if (!projectPath) throw new Error('Project download unavailable')
      await page.locator('input[type=file]').setInputFiles({ name: 'traced.photolisa', mimeType: 'application/x-photolisa', buffer: await readFile(projectPath) })
      await page.getByRole('button', { name: 'layers', exact: true }).click()
      await expect(page.getByText('sample vector', { exact: true }).last()).toBeVisible()
    }
  })
}
