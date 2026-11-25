import { SearchQuery, SearchResult } from "@flockr/contracts"
import { searchBoard } from "../board/search"
import { ok, operation, router } from "./shared"

const tags: [string] = ["search"]

export const searchRoutes = router().openapi(
  operation({
    method: "get",
    path: "/api/search",
    operationId: "searchBoard",
    tags,
    summary: "Find messages, replies and tasks by text across channels, best match first, with a highlighted snippet. Deleted messages are never found.",
    request: { query: SearchQuery },
    responses: ok(SearchResult),
  }),
  async (c) => c.json(await searchBoard(c.var.db, c.req.valid("query"), c.var.member), 200),
)
