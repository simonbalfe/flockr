import { ChannelParams, SchedulePostBody, ScheduledParams, ScheduledPost } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { cancelScheduledPost, listScheduledPosts, schedulePost } from "../board/scheduled"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["messages"]

export const scheduledRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/scheduled",
      operationId: "schedulePost",
      tags,
      summary: "Post a message once at a set time, as you, through the job table. It posts within about a minute of the time if you can still see the channel; cancel it before then",
      request: { params: ChannelParams, body: jsonBody(SchedulePostBody) },
      responses: ok(ScheduledPost),
    }),
    async (c) => c.json(await schedulePost(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/me/scheduled",
      operationId: "listScheduledPosts",
      tags,
      summary: "Your posts still waiting for their time, soonest first",
      responses: ok(z.array(ScheduledPost)),
    }),
    async (c) => c.json(await listScheduledPosts(c.var.db, c.var.member), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/scheduled/{id}/cancel",
      operationId: "cancelScheduledPost",
      tags,
      summary: "Cancel your scheduled post before it posts; safe to repeat",
      request: { params: ScheduledParams },
      responses: ok(ScheduledPost),
    }),
    async (c) => {
      const { channel, id } = c.req.valid("param")
      return c.json(await cancelScheduledPost(c.var.db, c.var.member, channel, id), 200)
    },
  )
