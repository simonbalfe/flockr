import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, createRoute, createRouter, redirect } from "@tanstack/react-router"
import { focusQueries } from "@/api/focus"
import { queries } from "@/api/hooks"
import { AppShell } from "@/components/app-shell"
import { parsePanelSearch } from "@/lib/panel"
import { AllTasks } from "@/routes/all-tasks"
import { ChannelAreas } from "@/routes/channel-areas"
import { ChannelFrame } from "@/routes/channel-frame"
import { ChannelMessages } from "@/routes/channel-messages"
import { ChannelTasks } from "@/routes/channel-tasks"
import { DraftsView } from "@/routes/drafts"
import { FocusView } from "@/routes/focus"
import { ApprovalsView } from "@/routes/approvals"
import { KeysView } from "@/routes/keys"
import { RoutinesView } from "@/routes/routines"
import { SavedView } from "@/routes/saved"
import { ThreadsView } from "@/routes/threads"

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  validateSearch: parsePanelSearch,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(queries.members()),
      context.queryClient.ensureQueryData(queries.channels()),
      context.queryClient.ensureQueryData(queries.agents()),
      context.queryClient.ensureQueryData(queries.tasks()),
      context.queryClient.ensureQueryData(focusQueries.focus()),
    ])
  },
  component: AppShell,
})

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: FocusView })

const channelRoute = createRoute({ getParentRoute: () => rootRoute, path: "/c/$channel", component: ChannelFrame })
const channelMessagesRoute = createRoute({ getParentRoute: () => channelRoute, path: "/", component: ChannelMessages })
const channelTasksRoute = createRoute({ getParentRoute: () => channelRoute, path: "/tasks", component: ChannelTasks })
const channelAreasRoute = createRoute({ getParentRoute: () => channelRoute, path: "/areas", component: ChannelAreas })
const allTasksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tasks", component: AllTasks })
const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search })
  },
})
const routinesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/routines", component: RoutinesView })
const approvalsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/approvals", component: ApprovalsView })
const threadsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/threads", component: ThreadsView })
const savedRoute = createRoute({ getParentRoute: () => rootRoute, path: "/saved", component: SavedView })
const draftsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/drafts", component: DraftsView })
const keysRoute = createRoute({ getParentRoute: () => rootRoute, path: "/keys", component: KeysView })

const routeTree = rootRoute.addChildren([
  indexRoute,
  channelRoute.addChildren([channelMessagesRoute, channelTasksRoute, channelAreasRoute]),
  allTasksRoute,
  inboxRoute,
  threadsRoute,
  savedRoute,
  draftsRoute,
  routinesRoute,
  approvalsRoute,
  keysRoute,
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
