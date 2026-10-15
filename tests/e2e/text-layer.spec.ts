import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('editable text survives native save and reopen and renders to PNG', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }) })
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File' }).click(); await page.getByRole('button', { name: 'New document…' }).click()
  await page.getByLabel('Width (px)').fill('256'); await page.getByLabel('Height (px)').fill('128')
  await page.getByRole('button', { name: 'Create' }).click(); await page.keyboard.press('Control+1')
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('Document canvas unavailable')
  await page.getByRole('button', { name: 'Text tool' }).click()
  await page.mouse.click(box.x + box.width / 2 - 90, box.y + box.height / 2 - 30)
  const content = page.getByLabel('Text content')
  await expect(content).toBeVisible()
  await content.fill('Hello')
  await content.blur()
  await page.getByLabel('Text color').fill('#ff0000')
  await expect(content).toHaveValue('Hello')
  await page.getByRole('button', { name: 'File' }).click()
  const pngDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG…' }).click()
  const pngPath = await (await pngDownload).path()
  if (!pngPath) throw new Error('PNG download unavailable')
  const pngBytes = await readFile(pngPath)
  const hasRed = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) > 200 && (data[i + 1] ?? 0) < 50 && (data[i + 3] ?? 0) > 0) return true
    return false
  }, [...pngBytes])
  expect(hasRed).toBe(true)
  await page.getByRole('button', { name: 'File' }).click()
  const projectDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save project/ }).click()
  const projectPath = await (await projectDownload).path()
  if (!projectPath) throw new Error('Project download unavailable')
  await page.locator('input[type=file]').setInputFiles({ name: 'project.photolisa', mimeType: 'application/x-photolisa', buffer: await readFile(projectPath) })
  await expect(page.getByLabel('Text content')).toHaveValue('Hello')
  await expect(page.getByLabel('Text color')).toHaveValue('#ff0000')
})
