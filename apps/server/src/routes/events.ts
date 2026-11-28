import { EventPage, EventsQuery } from "@flockr/contracts"
import { eventPage, headSeq } from "../board/events"
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
    const head = await headSeq(c.var.db)
    const page = await eventPage(c.var.db, query.since, query.limit, { kind: "member", viewer: c.var.viewer })
    return c.json({ ...page, head }, 200)
  },
)
