import { EventPage, EventsQuery } from "@flockr/contracts"
import { eventsSince, headSeq } from "../board/events"
import { ok, operation, router } from "./shared"

const tags: [string] = ["events"]

export const eventRoutes = router().openapi(
  operation({
    method: "get",
    path: "/api/events",
    operationId: "listEvents",
    tags,
    summary: "Read the board's event log after a sequence number, oldest first",
    request: { query: EventsQuery },
    responses: ok(EventPage),
  }),
  async (c) => {
    const query = c.req.valid("query")
    const [events, head] = await Promise.all([eventsSince(c.var.db, query.since, query.limit), headSeq(c.var.db)])
    return c.json({ events, head }, 200)
  },
)
