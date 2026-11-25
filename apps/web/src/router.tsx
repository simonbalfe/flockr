import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, createRoute, createRouter, redirect } from "@tanstack/react-router"
import { queries } from "@/api/hooks"
import { AppShell } from "@/components/app-shell"
import { parsePanelSearch } from "@/lib/panel"
import { AllTasks } from "@/routes/all-tasks"
import { ChannelFrame } from "@/routes/channel-frame"
import { ChannelMessages } from "@/routes/channel-messages"
import { ChannelTasks } from "@/routes/channel-tasks"
import { InboxView } from "@/routes/inbox"
import { RoutinesView } from "@/routes/routines"

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  validateSearch: parsePanelSearch,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(queries.members()),
      context.queryClient.ensureQueryData(queries.channels()),
      context.queryClient.ensureQueryData(queries.agents()),
      context.queryClient.ensureQueryData(queries.tasks()),
      context.queryClient.ensureQueryData(queries.inbox()),
    ])
  },
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/c/$channel", params: { channel: "backend" } })
  },
})

const channelRoute = createRoute({ getParentRoute: () => rootRoute, path: "/c/$channel", component: ChannelFrame })
const channelMessagesRoute = createRoute({ getParentRoute: () => channelRoute, path: "/", component: ChannelMessages })
const channelTasksRoute = createRoute({ getParentRoute: () => channelRoute, path: "/tasks", component: ChannelTasks })
const allTasksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tasks", component: AllTasks })
const inboxRoute = createRoute({ getParentRoute: () => rootRoute, path: "/inbox", component: InboxView })
const routinesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/routines", component: RoutinesView })

const routeTree = rootRoute.addChildren([
  indexRoute,
  channelRoute.addChildren([channelMessagesRoute, channelTasksRoute]),
  allTasksRoute,
  inboxRoute,
  routinesRoute,
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
