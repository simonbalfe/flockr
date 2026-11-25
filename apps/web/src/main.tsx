import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import { errorText } from "@/api/hooks"
import { createAppRouter } from "@/router"
import "@/index.css"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
  mutationCache: new MutationCache({ onError: (error) => toast.error(errorText(error)) }),
})

const router = createAppRouter(queryClient)

const container = document.getElementById("root")
if (!container) throw new Error("Missing #root")

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
