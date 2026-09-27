import { test, expect } from '@playwright/test';

test('End-to-End Mock Loop', async ({ page }) => {
  // 1. Load the app
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // 2. Locate the "Type what the partner says" input inside the main UI
  const input = page.getByPlaceholder('Type what the partner says, then Enter');
  await input.waitFor({ state: 'visible' });

  // 3. Type a sentence and submit it
  await input.fill('Are you hungry?');
  await page.keyboard.press('Enter');

  // 4. Verify the canned suggestions appear (matching 'hungry')
  const option = page.getByText("Yes, I'd love something to eat!");
  await expect(option).toBeVisible();

  // 5. Simulate the user selecting the option using the keyboard (Eye Tracking Mock)
  // We must click the body so the input loses focus, otherwise '1' gets typed.
  await page.locator('body').click({ position: { x: 0, y: 0 } });
  await page.keyboard.press('1');

  // 6. Verify the UI processes the selection
  // The options should disappear as the system "speaks" the reply and goes back to listening.
  await expect(option).toBeHidden();
});
