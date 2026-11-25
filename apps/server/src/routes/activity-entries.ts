import { ActivityEntry, ActivityEntryParams, ActivityEntryResult, CreateActivityBody, StopRunBody, StopRunResult, ThreadParams, UpdateActivityBody } from "@flockr/contracts"
import { createActivityEntry, getActivityEntry, stopRun, updateActivityEntry } from "../board/activity-entries"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["activity"]

export const activityEntryRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: "/api/threads/{id}/activity-entries",
      operationId: "createActivityEntry",
      tags,
      summary:
        "Post an activity entry in a thread: the work an agent is doing (tool calls, commands, reasoning, a plan, changed files, test runs, subagents, errors). It shows as one collapsed work block and keeps the acting member shown as working until its run finishes. Send key to make a retry safe.",
      request: { params: ThreadParams, body: jsonBody(CreateActivityBody) },
      responses: ok(ActivityEntryResult),
    }),
    async (c) => c.json(await createActivityEntry(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/activity-entries/{id}/updates",
      operationId: "updateActivityEntry",
      tags,
      summary:
        "Update your own activity entry with events: part.set adds or replaces a part, part.append streams output or text, part.finished ends a part, run.finished ends the run. Each call is one event in the log; reads return the latest state. Send the revision you last saw to make a retry safe.",
      request: { params: ActivityEntryParams, body: jsonBody(UpdateActivityBody) },
      responses: ok(ActivityEntryResult),
    }),
    async (c) => c.json(await updateActivityEntry(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/activity-entries/{id}",
      operationId: "getActivityEntry",
      tags,
      summary: "Read one activity entry at its latest state, with its revision",
      request: { params: ActivityEntryParams },
      responses: ok(ActivityEntry),
    }),
    async (c) => c.json(await getActivityEntry(c.var.db, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/threads/{id}/stop",
      operationId: "stopRun",
      tags,
      summary:
        "Ask a working member to stop its run in a thread. Writes a run.stop_requested event the member's runner acts on, and marks its running entries as stop requested. A person, the member itself or its owner may ask; repeating it changes nothing.",
      request: { params: ThreadParams, body: jsonBody(StopRunBody) },
      responses: ok(StopRunResult),
    }),
    async (c) => c.json({ requests: await stopRun(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")) }, 200),
  )
