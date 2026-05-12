/**
 * End-to-end happy-path smoke against a running stack:
 *   register → DB-activate (skips email click) → login → add device → see it
 *
 * Run with: pnpm exec playwright test
 * Assumes the stack is up via `make up`.
 *
 * Why we DB-activate: the verify-email plaintext token is only emitted in
 * the email link (the row stores a sha256 hash), so a black-box smoke test
 * cannot recover it. We exercise the verify-email path separately in the
 * Rust integration tests; here we just need the user usable for the rest
 * of the device-creation flow.
 */
import { execSync } from "node:child_process"

import { expect, test } from "@playwright/test"

const PASSWORD = "correcthorsebatterystaple"

function activateUserInDb(email: string) {
  execSync(
    `docker compose exec -T db psql -U zerovpn -d zerovpn -c "UPDATE users SET status='active', email_verified_at=NOW() WHERE email='${email}'"`,
    { stdio: "pipe" },
  )
}

test("user can register, log in, and add a device", async ({ page }) => {
  const email = `e2e-${Date.now()}@local.test`

  // Register — now lands on the "check your email" screen.
  await page.goto("/register")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByLabel("Confirm").fill(PASSWORD)
  await page.getByRole("button", { name: /Create account/i }).click()
  await expect(page.getByText(/Check your inbox/i)).toBeVisible({
    timeout: 10_000,
  })

  // Stand in for the user clicking the verify link.
  activateUserInDb(email)

  // Sign in
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: /Continue/i }).click()

  await page.waitForURL(/\/app|\/admin/, { timeout: 15_000 })
  if (page.url().includes("/admin")) {
    await page.getByRole("link", { name: /User dashboard/i }).click()
    await page.waitForURL(/\/app/)
  }

  // Add a device
  await page.getByPlaceholder(/Device name/i).fill("E2E Laptop")
  await page.getByRole("button", { name: /^Add device$/i }).click()

  await expect(page.getByRole("button", { name: /Download \.conf/i })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText("E2E Laptop").first()).toBeVisible()
})
