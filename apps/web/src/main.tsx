import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import { recheckSession } from "@/api/auth"
import { errorText } from "@/api/hooks"
import { SessionGate } from "@/components/session-gate"
import { createAppRouter } from "@/router"
import "@/index.css"

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: (error) => recheckSession(queryClient, error) }),
  mutationCache: new MutationCache({
    onError: (error) => {
      recheckSession(queryClient, error)
      toast.error(errorText(error))
    },
  }),
})

const router = createAppRouter(queryClient)

const container = document.getElementById("root")
if (!container) throw new Error("Missing #root")

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionGate>
        <RouterProvider router={router} />
      </SessionGate>
    </QueryClientProvider>
  </StrictMode>,
)
