import { HeartbeatBody, HeartbeatResult, Machine, MachineParams, RegisterMachineBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { heartbeat, listMachines, registerMachine } from "../board/machines"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["machines"]

export const machineRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/machines",
      operationId: "listMachines",
      tags,
      summary: "List machines whose runners serve agents, with the harnesses each can run and whether it is online",
      responses: ok(z.array(Machine)),
    }),
    async (c) => c.json(await listMachines(c.var.db), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/machines",
      operationId: "registerMachine",
      tags,
      summary: "For runners: register this machine and the harnesses it can run; safe to repeat",
      request: { body: jsonBody(RegisterMachineBody) },
      responses: ok(Machine),
    }),
    async (c) => c.json(await registerMachine(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/machines/{id}/heartbeat",
      operationId: "machineHeartbeat",
      tags,
      summary: "For runners: say the machine is alive and report each served agent's state; returns the agents assigned to it",
      request: { params: MachineParams, body: jsonBody(HeartbeatBody) },
      responses: ok(HeartbeatResult),
    }),
    async (c) => c.json(await heartbeat(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
