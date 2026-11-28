import { BlockRecord, ChannelParams, ListBlocksQuery } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { listBlocks } from "../board/blocks"
import { ok, operation, router } from "./shared"

const tags: [string] = ["messages"]

export const blockRoutes = router().openapi(
  operation({
    method: "get",
    path: "/api/channels/{channel}/blocks",
    operationId: "listBlocks",
    tags,
    summary:
      "Typed blocks posted in a channel, newest first, as data: approvals (who approved which task at which commit), deliverables, decisions and hand-off records (summary, branch, commit, files, tests, next steps). Filter by kind and task",
    request: { params: ChannelParams, query: ListBlocksQuery },
    responses: ok(z.array(BlockRecord)),
  }),
  async (c) => c.json(await listBlocks(c.var.db, c.req.valid("param").channel, c.req.valid("query")), 200),
)
