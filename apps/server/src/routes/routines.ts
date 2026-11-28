import { Brief, CreateRoutineBody, DeletedRoutine, Job, Routine, RoutineJobsQuery, RoutineParams, UpdateRoutineBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { buildBrief } from "../board/brief"
import { createRoutine, deleteRoutine, disableRoutine, enableRoutine, getRoutine, listRoutineJobs, listRoutines, updateRoutine } from "../board/routines"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["routines"]

export const routineRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/routines",
      operationId: "listRoutines",
      tags,
      summary: "Every routine on the board: its trigger (a schedule or an event in its channel), its one action, whether it is on, and its last runs",
      responses: ok(z.array(Routine)),
    }),
    async (c) => c.json(await listRoutines(c.var.db), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/routines",
      operationId: "createRoutine",
      tags,
      summary: "Create a routine; it is off until a person turns it on. Only a person can create one",
      request: { body: jsonBody(CreateRoutineBody) },
      responses: ok(Routine),
    }),
    async (c) => c.json(await createRoutine(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/routines/{id}",
      operationId: "getRoutine",
      tags,
      summary: "One routine with its last runs",
      request: { params: RoutineParams },
      responses: ok(Routine),
    }),
    async (c) => c.json(await getRoutine(c.var.db, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "patch",
      path: "/api/routines/{id}",
      operationId: "updateRoutine",
      tags,
      summary: "Change a routine's name, channel, trigger, action or hourly limit; whether it is on does not change. Only a person can change one",
      request: { params: RoutineParams, body: jsonBody(UpdateRoutineBody) },
      responses: ok(Routine),
    }),
    async (c) => c.json(await updateRoutine(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/routines/{id}/on",
      operationId: "enableRoutine",
      tags,
      summary: "Turn a routine on: it fires on its own trigger from now on; safe to repeat. Only a person can",
      request: { params: RoutineParams },
      responses: ok(Routine),
    }),
    async (c) => c.json(await enableRoutine(c.var.db, c.var.member, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/routines/{id}/off",
      operationId: "disableRoutine",
      tags,
      summary: "Turn a routine off: runs already queued are skipped; safe to repeat. Only a person can",
      request: { params: RoutineParams },
      responses: ok(Routine),
    }),
    async (c) => c.json(await disableRoutine(c.var.db, c.var.member, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "delete",
      path: "/api/routines/{id}",
      operationId: "deleteRoutine",
      tags,
      summary: "Turn a routine off and remove it; its past runs stay; safe to repeat. Only a person can",
      request: { params: RoutineParams },
      responses: ok(DeletedRoutine),
    }),
    async (c) => c.json(await deleteRoutine(c.var.db, c.var.member, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/routines/{id}/jobs",
      operationId: "listRoutineJobs",
      tags,
      summary: "A routine's runs, newest first: what caused each, its state, attempts, what it did and its last error",
      request: { params: RoutineParams, query: RoutineJobsQuery },
      responses: ok(z.array(Job)),
    }),
    async (c) => c.json(await listRoutineJobs(c.var.db, c.req.valid("param").id, c.req.valid("query").limit), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/brief",
      operationId: "getBrief",
      tags,
      summary: "The morning brief as of now: tasks finished in the last 24 hours, every blocked task with its reason, and the questions and reviews waiting for a person, plus the text the brief action posts",
      responses: ok(Brief),
    }),
    async (c) => c.json(await buildBrief(c.var.db, c.var.viewer), 200),
  )
