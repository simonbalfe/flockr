import { CreatePlanBody, ListPlansQuery, Plan, PlanDetail, PlanWait, PlanWaitQuery, SetTaskPlanBody, Task, TaskParams, UpdatePlanBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createPlan, getPlan, listPlans, setPlanClosed, setTaskPlan, updatePlan, waitForPlan } from "../board/plans"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["plans"]

const PlanParams = z.object({ id: z.coerce.number().int().openapi({ type: "integer", param: { name: "id", in: "path", required: true }, example: 3 }) })

export const planRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/plans",
      operationId: "listPlans",
      tags,
      summary: "List plans, newest first, each with its progress counted from its tasks' states. Open plans by default; state=closed lists the closed ones; channel narrows to one channel",
      request: { query: ListPlansQuery },
      responses: ok(z.array(Plan)),
    }),
    async (c) => c.json(await listPlans(c.var.db, c.var.viewer, c.req.valid("query")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/plans",
      operationId: "createPlan",
      tags,
      summary: "Make a plan in a channel: a title and a goal that groups the tasks for one piece of work. Send a key so a retry returns the same plan and writes nothing; a channel holds at most 50 open plans",
      request: { body: jsonBody(CreatePlanBody) },
      responses: ok(Plan),
    }),
    async (c) => c.json(await createPlan(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/plans/{id}",
      operationId: "getPlan",
      tags,
      summary: "Show one plan with its progress and its tasks in creation order",
      request: { params: PlanParams },
      responses: ok(PlanDetail),
    }),
    async (c) => c.json(await getPlan(c.var.db, c.var.viewer, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/plans/{id}/wait",
      operationId: "waitForPlan",
      tags,
      summary: "Wait until every task of the plan is done or canceled, or the timeout passes. Returns the plan, whether it finished and the tasks still open; a failed task keeps it open",
      request: { params: PlanParams, query: PlanWaitQuery },
      responses: ok(PlanWait),
    }),
    async (c) => c.json(await waitForPlan(c.var.db, c.var.viewer, c.req.valid("param").id, c.req.valid("query")), 200),
  )
  .openapi(
    operation({
      method: "patch",
      path: "/api/plans/{id}",
      operationId: "updatePlan",
      tags,
      summary: "Change a plan's title or goal; the edit is an event, and an edit that changes nothing writes nothing",
      request: { params: PlanParams, body: jsonBody(UpdatePlanBody) },
      responses: ok(Plan),
    }),
    async (c) => c.json(await updatePlan(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/plans/{id}/close",
      operationId: "closePlan",
      tags,
      summary: "Close a plan: it leaves the open list and no task can join it; its tasks keep going. Safe to repeat",
      request: { params: PlanParams },
      responses: ok(Plan),
    }),
    async (c) => c.json(await setPlanClosed(c.var.db, c.var.member, c.req.valid("param").id, true), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/plans/{id}/reopen",
      operationId: "reopenPlan",
      tags,
      summary: "Reopen a closed plan so tasks can join it again. Safe to repeat",
      request: { params: PlanParams },
      responses: ok(Plan),
    }),
    async (c) => c.json(await setPlanClosed(c.var.db, c.var.member, c.req.valid("param").id, false), 200),
  )
  .openapi(
    operation({
      method: "put",
      path: "/api/tasks/{id}/plan",
      operationId: "setTaskPlan",
      tags,
      summary: "Put a task in a plan, or take it out with plan null. The plan must be open and in the task's channel; setting the plan it already has writes nothing",
      request: { params: TaskParams, body: jsonBody(SetTaskPlanBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await setTaskPlan(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json").plan), 200),
  )
