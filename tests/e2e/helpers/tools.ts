import type { Page } from '@playwright/test'

/** Additional tools now live in the compact toolbar's accessible flyout. */
export async function selectEditorTool(page: Page, name: string): Promise<void> {
  const tool = page.getByRole('button', { name })
  if (!await tool.isVisible()) await page.getByRole('button', { name: 'More tools', exact: true }).click()
  await tool.click()
}
