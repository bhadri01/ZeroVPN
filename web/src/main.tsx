import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router"
import { QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"

import "./index.css"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { queryClient } from "@/lib/query"
import { router } from "@/routes"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
