import { IconArrowLeft, IconHome } from "@tabler/icons-react"
import { isRouteErrorResponse, Link, useRouteError } from "react-router"

import { Eyebrow } from "@/components/swiss"
import { Button } from "@/components/ui/button"

/**
 * Route-level error element. Catches `throw redirect()`s and any uncaught
 * render error in the matched route. Swiss-styled — eyebrow status code,
 * h1 with monospace heading, terse description, two ghost CTAs. No
 * Card chrome — sits flush inside the dashboard outlet.
 */
export function RouteError() {
  const error = useRouteError()
  let status: number | null = null
  let title = "Something went wrong"
  let detail =
    "An unexpected error occurred. Try the navigation in the sidebar."

  if (isRouteErrorResponse(error)) {
    status = error.status
    if (error.status === 404) {
      title = "Page not found"
      detail =
        "The page you're looking for doesn't exist (or has been moved). Check the URL or jump back to the dashboard."
    } else if (error.status === 401) {
      title = "Sign-in required"
      detail = "Your session has expired. Please sign in again."
    } else if (error.status === 403) {
      title = "Forbidden"
      detail = "You don't have permission to view this page."
    } else {
      title = `${error.status} ${error.statusText}`
      detail =
        typeof error.data === "string"
          ? error.data
          : "Something went wrong on the server."
    }
  } else if (error instanceof Error) {
    detail = error.message
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-20">
      <Eyebrow num={status ?? "—"}>error · route</Eyebrow>
      <h1 className="font-heading text-4xl font-medium tracking-tight">
        {title}
      </h1>
      <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
        {detail}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to=".." relative="path">
            <IconArrowLeft />
            Back
          </Link>
        </Button>
        <Button asChild>
          <Link to="/app">
            <IconHome />
            Dashboard
          </Link>
        </Button>
      </div>
    </div>
  )
}

/**
 * Standalone variant for use as a public-route errorElement (no sidebar
 * around it). Same content, different default action target.
 */
export function PublicRouteError() {
  const error = useRouteError()
  const status = isRouteErrorResponse(error) ? error.status : null
  const title =
    status === 404
      ? "Page not found"
      : status
        ? `${status} ${(error as { statusText?: string }).statusText ?? ""}`
        : "Something went wrong"
  const detail =
    status === 404
      ? "The page you're looking for doesn't exist or has been moved."
      : error instanceof Error
        ? error.message
        : "An unexpected error occurred."

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <Eyebrow num={status ?? "—"}>error · public</Eyebrow>
        <h1 className="font-heading text-4xl font-medium tracking-tight">
          {title}
        </h1>
        <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
          {detail}
        </p>
        <div>
          <Button asChild>
            <Link to="/">
              <IconHome />
              Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
