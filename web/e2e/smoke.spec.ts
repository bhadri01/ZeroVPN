/**
 * End-to-end happy-path smoke against a running stack:
 *   register → click verify link from MailHog → land on /app (auto-signed
 *   in) → add device → see it listed.
 *
 * Run with: pnpm exec playwright test
 * Assumes the stack is up via `make up`. The dev compose includes MailHog
 * (UI + API on :8025, SMTP on :1025), which the API points at via
 * ZEROVPN_SMTP__HOST=mailhog, so registration produces a real captured
 * verification email we can scrape here.
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
      // MailHog returns messages newest-first. Find the verify-email
      // mail addressed to this run's throwaway address. We match on the
      // local-part to avoid coupling to MailHog's domain handling.
      const local = email.split("@")[0]
      const msg = data.items.find((m) =>
        m.To.some((t) => t.Mailbox === local),
      )
      if (msg) {
        const match = msg.Content.Body.match(/verify-email\?token=([^\s>]+)/)
        if (match) return match[1].replace(/=+$/, "")
      }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`No verify-email message for ${email} after 15s`)
}

test("user can register, verify, log in, and add a device", async ({ page }) => {
  const email = `e2e-${Date.now()}@local.test`

  // Empty the catcher so we don't read a stale message from a previous run.
  await fetch(`${MAILHOG_API}/messages`, { method: "DELETE" }).catch(() => {})

  // Register → "Check your inbox" screen.
  await page.goto("/register")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByLabel("Confirm").fill(PASSWORD)
  await page.getByRole("button", { name: /Create account/i }).click()
  await expect(page.getByText(/Check your inbox/i)).toBeVisible({
    timeout: 10_000,
  })

  // Pull the verify token out of MailHog and visit the verify URL. The
  // backend establishes a session on success, and VerifyEmailPage navigates
  // straight to /app.
  const token = await fetchVerifyTokenFromMailHog(email)
  await page.goto(`/verify-email?token=${encodeURIComponent(token)}`)
  await page.waitForURL(/\/app|\/admin/, { timeout: 15_000 })

  // First registered user becomes admin — drop into the user dashboard.
  if (page.url().includes("/admin")) {
    await page.getByRole("link", { name: /User dashboard/i }).click()
    await page.waitForURL(/\/app/)
  }

  await page.getByPlaceholder(/Device name/i).fill("E2E Laptop")
  await page.getByRole("button", { name: /^Add device$/i }).click()

  await expect(page.getByRole("button", { name: /Download \.conf/i })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText("E2E Laptop").first()).toBeVisible()
})
