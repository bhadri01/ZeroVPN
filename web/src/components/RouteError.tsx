import {
  IconAlertOctagon,
  IconArrowLeft,
  IconExclamationCircle,
  IconHome,
} from "@tabler/icons-react"
import { isRouteErrorResponse, Link, useRouteError } from "react-router"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

/**
 * Route-level error element. Catches `throw redirect()`s and any uncaught
 * render error in the matched route. We render a calm, branded page rather
 * than the React Router default "Hey developer 👋" splash.
 */
export function RouteError() {
  const error = useRouteError()
  let status: number | null = null
  let title = "Something went wrong"
  let detail = "An unexpected error occurred. Try the navigation in the sidebar."

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

  const Icon = status === 404 ? IconExclamationCircle : IconAlertOctagon

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardContent className="space-y-6 pt-6 text-center">
          <span className="bg-muted text-muted-foreground mx-auto flex size-12 items-center justify-center rounded-full">
            <Icon className="size-5" />
          </span>
          <div className="space-y-1">
            {status && (
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                Error {status}
              </p>
            )}
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground mx-auto max-w-sm text-sm">
              {detail}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
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
        </CardContent>
      </Card>
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
      <div className="w-full max-w-md">
        <Card>
          <CardContent className="space-y-6 pt-6 text-center">
            <span className="bg-muted text-muted-foreground mx-auto flex size-12 items-center justify-center rounded-full">
              <IconExclamationCircle className="size-5" />
            </span>
            <div className="space-y-1">
              {status && (
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                  Error {status}
                </p>
              )}
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              <p className="text-muted-foreground text-sm">{detail}</p>
            </div>
            <div className="flex justify-center">
              <Button asChild>
                <Link to="/">
                  <IconHome />
                  Home
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
