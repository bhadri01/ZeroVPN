/**
 * End-to-end happy-path smoke against a running stack:
 *   register → login (auto-redirect to /app) → add device → see it listed
 *
 * Run with: pnpm exec playwright test
 * Assumes the stack is up via `make up`.
 */
import { expect, test } from "@playwright/test"

const PASSWORD = "correcthorsebatterystaple"

test("user can register, log in, and add a device", async ({ page }) => {
  const email = `e2e-${Date.now()}@local.test`

  // Register
  await page.goto("/register")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByLabel("Confirm password").fill(PASSWORD)
  await page.getByRole("button", { name: /Create account/i }).click()

  // Should land on /app or /admin (first user becomes admin in fresh DB)
  await page.waitForURL(/\/app|\/admin/, { timeout: 15_000 })

  // If on /admin, click into User dashboard
  if (page.url().includes("/admin")) {
    await page.getByRole("link", { name: /User dashboard/i }).click()
    await page.waitForURL(/\/app/)
  }

  // Add a device
  await page.getByPlaceholder(/Device name/i).fill("E2E Laptop")
  await page.getByRole("button", { name: /^Add device$/i }).click()

  // The newly-created device card shows the QR + Download/Copy controls
  await expect(page.getByRole("button", { name: /Download \.conf/i })).toBeVisible({
    timeout: 10_000,
  })

  // The device should be in the list
  await expect(page.getByText("E2E Laptop").first()).toBeVisible()
})
