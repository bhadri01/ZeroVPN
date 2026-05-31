/**
 * E2E for the "Default landing" preference: setting it should change where a
 * user lands after signing in (previously the setting was saved but ignored —
 * login always went to the dashboard).
 *
 * Flow: register → verify (auto sign-in) → Settings: set Default landing to
 * Devices → drop the session → sign back in → assert we land on /app/devices.
 *
 * Run with: pnpm exec playwright test e2e/preferences.spec.ts
 * Assumes the stack is reachable at E2E_BASE_URL (default http://localhost),
 * with MailHog on :8025 — same prerequisites as smoke.spec.ts.
 */
import { expect, test } from "@playwright/test"

const PASSWORD = "correcthorsebatterystaple"
const MAILHOG_API = "http://localhost:8025/api/v2"

interface MailHogMessage {
  ID: string
  Content: { Headers: Record<string, string[]>; Body: string }
  To: { Mailbox: string; Domain: string }[]
}

async function fetchVerifyTokenFromMailHog(email: string): Promise<string> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILHOG_API}/messages`)
    if (res.ok) {
      const data = (await res.json()) as { items: MailHogMessage[] }
      const local = email.split("@")[0]
      const msg = data.items.find((m) => m.To.some((t) => t.Mailbox === local))
      if (msg) {
        const match = msg.Content.Body.match(/verify-email\?token=([^\s>]+)/)
        if (match) return match[1].replace(/=+$/, "")
      }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`No verify-email message for ${email} after 15s`)
}

test("default-landing preference controls the post-login destination", async ({
  page,
  context,
}) => {
  const email = `e2e-pref-${Date.now()}@local.test`
  await fetch(`${MAILHOG_API}/messages`, { method: "DELETE" }).catch(() => {})

  // Register → verify → auto signed-in (lands on /app or /admin).
  await page.goto("/register")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByLabel("Confirm").fill(PASSWORD)
  await page.getByRole("button", { name: /Create account/i }).click()
  await expect(
    page.getByRole("heading", { name: /Check your inbox/i }),
  ).toBeVisible({ timeout: 10_000 })

  const token = await fetchVerifyTokenFromMailHog(email)
  await page.goto(`/verify-email?token=${encodeURIComponent(token)}`)
  await page.waitForURL(/\/app|\/admin/, { timeout: 15_000 })

  // Settings → set Default landing to Devices, waiting for the persist PUT so
  // the choice is durable before we drop the session.
  await page.goto("/app/settings")
  const saved = page.waitForResponse(
    (r) =>
      r.url().includes("/me/preferences") &&
      r.request().method() === "PUT" &&
      r.ok(),
  )
  await page.getByRole("button", { name: "Devices", exact: true }).click()
  await saved

  // Drop the session and sign back in. The post-login redirect should now
  // honor the saved preference and land on /app/devices (not the dashboard).
  await context.clearCookies()
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: /Continue/i }).click()

  await page.waitForURL(/\/app\/devices$/, { timeout: 15_000 })
  await expect(page).toHaveURL(/\/app\/devices$/)
})
