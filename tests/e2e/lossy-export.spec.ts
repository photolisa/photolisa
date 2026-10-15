import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('JPEG quality and file name are available through the export workflow', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /New document/ }).click()
  await page.getByLabel('Name').fill('Export quality')
  await page.getByLabel('Width (px)').fill('64')
  await page.getByLabel('Height (px)').fill('64')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Export JPEG…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export JPEG' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Export file name').fill('my portrait')
  await dialog.getByLabel('Export quality').fill('35')
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('my-portrait.jpg')
  const path = await download.path()
  if (!path) throw new Error('JPEG download unavailable')
  const bytes = await readFile(path)
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  await expect(dialog).toHaveCount(0)
})
