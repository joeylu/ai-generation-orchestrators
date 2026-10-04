import { expect, type Page } from '@playwright/test';

/** Wait for the mounted public tree before using its strict document getter. */
export async function waitForWorkbenchDocument(page: Page, id: string): Promise<void> {
  await expect.poll(() => page.evaluate(() =>
    window.uiHarness.inspect().instances === 1 && window.uiHarness.getDocument()?.id,
  )).toBe(id);
  await expect(page.locator('#error')).toBeHidden();
}
