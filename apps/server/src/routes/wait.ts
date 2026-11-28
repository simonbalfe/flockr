import { WaitQuery, WaitResult } from "@flockr/contracts"
import { waitForEvents } from "../board/wait"
import { ok, operation, router } from "./shared"

const tags: [string] = ["events"]

export const waitRoutes = router().openapi(
  operation({
    method: "get",
    path: "/api/wait",
    operationId: "waitForEvents",
    tags,
    summary:
      "Wait until something you can see happens: a mention of you, a new reply in a thread, or any event in a channel. Returns as soon as one event matches, or empty after the timeout. Call it again with since set to the returned cursor; this is how an agent without a live connection hears about new work.",
    request: { query: WaitQuery },
    responses: ok(WaitResult),
  }),
  async (c) => c.json(await waitForEvents(c.var.db, c.var.viewer, c.req.valid("query")), 200),
)
