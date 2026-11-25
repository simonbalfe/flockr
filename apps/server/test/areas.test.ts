import { describe, expect, test } from "bun:test"
import { DeclareAreaResult, ErrorBody, EventPage, Task, WorkingArea } from "@flockr/contracts"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { sweepExpiredAreas } from "../src/board/areas"
import { sweepExpiredClaims } from "../src/board/claims"
import { tasks, workingAreas } from "../src/db/schema"
import { freshBoard } from "./harness"

type Call = Awaited<ReturnType<typeof freshBoard>>["call"]

const task = (json: unknown) => Task.parse(json)
const declared = (json: unknown) => DeclareAreaResult.parse(json)
const areaList = (json: unknown) => z.array(WorkingArea).parse(json)

async function claimNew(call: Call, member: string, title: string) {
  const made = task((await call("simon", "POST", "/api/tasks", { channel: "backend", title, assignee: member })).json)
  return task((await call(member, "POST", `/api/tasks/${made.id}/claim`)).json)
}

const declare = (call: Call, member: string, body: unknown) => call(member, "POST", "/api/channels/backend/areas", body)
const live = async (call: Call) => areaList((await call("simon", "GET", "/api/channels/backend/areas")).json)

describe("working areas", () => {
  test("an overlap is a warning by default: the area is declared and the other member's area comes back", async () => {
    const { call } = await freshBoard()
    const a = await claimNew(call, "claude", "Users API")
    const b = await claimNew(call, "codex", "Users tests")
    const first = declared((await declare(call, "claude", { taskId: a.id, epoch: a.claimEpoch, paths: ["apps/server/src/board", "packages/contracts/**"] })).json)
    expect(first.overlaps).toEqual([])
    expect(first.area.branch).toBe(`flockr/${a.id}`)
    const second = declared((await declare(call, "codex", { taskId: b.id, epoch: b.claimEpoch, paths: ["apps/server/src/board/claims.ts", "apps/web"] })).json)
    expect(second.overlaps).toHaveLength(1)
    expect(second.overlaps[0]).toMatchObject({ area: { owner: "claude", taskId: a.id, branch: `flockr/${a.id}` }, paths: [{ yours: "apps/server/src/board/claims.ts", theirs: "apps/server/src/board" }] })
    expect((await live(call)).map((x) => x.owner)).toEqual(["claude", "codex"])
  })

  test("with overlap refuse an overlap is a 409 that names who and where, and nothing is declared", async () => {
    const { call } = await freshBoard()
    const a = await claimNew(call, "claude", "Users API")
    const b = await claimNew(call, "codex", "Users tests")
    await declare(call, "claude", { taskId: a.id, epoch: a.claimEpoch, paths: ["apps/server"] })
    const refused = await declare(call, "codex", { taskId: b.id, epoch: b.claimEpoch, paths: ["apps/server/src"], overlap: "refuse" })
    expect(refused.status).toBe(409)
    const body = ErrorBody.parse(refused.json)
    expect(body.kind).toBe("area_overlap")
    expect(body.error).toContain(`claude, #${a.id} on flockr/${a.id}`)
    expect((await live(call)).map((x) => x.owner)).toEqual(["claude"])
    expect(declared((await declare(call, "codex", { taskId: b.id, epoch: b.claimEpoch, paths: ["apps/web"], overlap: "refuse" })).json).overlaps).toEqual([])
  })

  test("two members refusing the same folder at once: exactly one wins", async () => {
    for (let round = 0; round < 4; round++) {
      const { call } = await freshBoard()
      const [a, b] = await Promise.all([claimNew(call, "claude", "One"), claimNew(call, "codex", "Two")])
      const results = await Promise.all([
        declare(call, "claude", { taskId: a.id, epoch: a.claimEpoch, paths: ["apps/server/src"], overlap: "refuse" }),
        declare(call, "codex", { taskId: b.id, epoch: b.claimEpoch, paths: ["apps/server/src/board"], overlap: "refuse" }),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      expect(await live(call)).toHaveLength(1)
    }
  })

  test("your own areas never overlap you, and declaring again for the task replaces its paths without a second area", async () => {
    const { call } = await freshBoard()
    const a = await claimNew(call, "claude", "Users API")
    const body = { taskId: a.id, epoch: a.claimEpoch, paths: ["apps/server"] }
    const first = declared((await declare(call, "claude", body)).json)
    expect(declared((await declare(call, "claude", body)).json).area.id).toBe(first.area.id)
    const moved = declared((await declare(call, "claude", { ...body, paths: ["apps/web"] })).json)
    expect(moved.area.id).toBe(first.area.id)
    expect((await live(call)).map((x) => x.paths)).toEqual([["apps/web"]])
    const own = declared((await declare(call, "claude", { paths: ["apps/web/src"] })).json)
    expect(own.overlaps).toEqual([])
  })

  test("an area with a task follows the claim: complete, release and an expired lease each end it", async () => {
    const { call, db } = await freshBoard()
    const a = await claimNew(call, "claude", "Finishes")
    const b = await claimNew(call, "codex", "Releases")
    const c = await claimNew(call, "claude", "Expires")
    for (const [member, t, path] of [["claude", a, "a"], ["codex", b, "b"], ["claude", c, "c"]] as const) {
      await declare(call, member, { taskId: t.id, epoch: t.claimEpoch, paths: [path] })
    }
    expect(await live(call)).toHaveLength(3)
    await call("claude", "POST", `/api/tasks/${a.id}/complete`, { epoch: a.claimEpoch })
    expect((await live(call)).map((x) => x.taskId)).toEqual([b.id, c.id])
    await call("codex", "POST", `/api/tasks/${b.id}/release`, { epoch: b.claimEpoch })
    expect((await live(call)).map((x) => x.taskId)).toEqual([c.id])
    await db.update(tasks).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(tasks.id, c.id))
    await sweepExpiredClaims(db)
    expect(await live(call)).toEqual([])
    const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
    expect(page.events.filter((e) => e.type === "area.released").map((e) => e.data.reason)).toEqual(["task_ended", "task_ended", "expired"])
  })

  test("an area for a task needs the claim: not the holder, a stale epoch and an unclaimed task are refused", async () => {
    const { call } = await freshBoard()
    const a = await claimNew(call, "claude", "Mine")
    expect((await declare(call, "codex", { taskId: a.id, epoch: a.claimEpoch, paths: ["x"] })).status).toBe(409)
    expect((await declare(call, "claude", { taskId: a.id, epoch: a.claimEpoch + 1, paths: ["x"] })).status).toBe(409)
    expect((await declare(call, "claude", { taskId: 806, paths: ["x"] })).status).toBe(409)
    expect((await declare(call, "claude", { paths: ["../outside"] })).status).toBe(400)
  })

  test("an area with no task runs out after an hour unless renewed, and release is safe to repeat", async () => {
    const { call, db } = await freshBoard()
    const own = declared((await declare(call, "simon", { paths: ["docs"] })).json).area
    expect(own.expiresAt).not.toBeNull()
    const renewed = WorkingArea.parse((await call("simon", "POST", `/api/channels/backend/areas/${own.id}/renew`)).json)
    expect(new Date(renewed.expiresAt ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(own.expiresAt ?? 0).getTime())
    expect((await call("claude", "POST", `/api/channels/backend/areas/${own.id}/release`)).status).toBe(403)
    expect((await call("simon", "POST", `/api/channels/backend/areas/${own.id}/release`)).status).toBe(200)
    expect((await call("simon", "POST", `/api/channels/backend/areas/${own.id}/release`)).status).toBe(200)
    const other = declared((await declare(call, "simon", { paths: ["src"] })).json).area
    await db.update(workingAreas).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(workingAreas.id, other.id))
    expect(await live(call)).toEqual([])
    expect(await sweepExpiredAreas(db)).toEqual([other.id])
    expect(await sweepExpiredAreas(db)).toEqual([])
  })
})

describe("hand-offs", () => {
  test("the task, its branch and its areas move to the new holder under a new epoch, with the note in the thread", async () => {
    const { call } = await freshBoard()
    const a = await claimNew(call, "claude", "Users API")
    await declare(call, "claude", { taskId: a.id, epoch: a.claimEpoch, paths: ["apps/server/src/board"] })
    const res = await call("claude", "POST", `/api/tasks/${a.id}/handoff`, { to: "codex", note: "Routes done, tests left", lastCommit: "abc1234def", testState: "bun test passes", nextSteps: ["Add route tests"], epoch: a.claimEpoch })
    expect(res.status).toBe(200)
    const moved = task(res.json)
    expect(moved).toMatchObject({ state: "claimed", holder: "codex", assignee: "codex", claimEpoch: a.claimEpoch + 1, branch: `flockr/${a.id}` })
    expect((await live(call)).map((x) => [x.owner, x.taskId])).toEqual([["codex", a.id]])
    const thread = (await call("simon", "GET", `/api/threads/${a.id}`)).json
    expect(JSON.stringify(thread)).toContain("Routes done, tests left")
    expect(JSON.stringify(thread)).toContain("Tests: bun test passes")
    expect(JSON.stringify(thread)).toContain("handed this task to codex")
    const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
    expect(page.events.find((e) => e.type === "task.handed_off")?.data).toMatchObject({ from: "claude", to: "codex", fromEpoch: a.claimEpoch, epoch: a.claimEpoch + 1, branch: `flockr/${a.id}` })
  })

  test("a stale holder's hand-off is refused, the old epoch no longer writes, and a repeat of the same hand-off changes nothing", async () => {
    const { call } = await freshBoard()
    const a = await claimNew(call, "claude", "Users API")
    const body = { to: "codex", epoch: a.claimEpoch }
    expect((await call("claude", "POST", `/api/tasks/${a.id}/handoff`, body)).status).toBe(200)
    const repeat = await call("claude", "POST", `/api/tasks/${a.id}/handoff`, body)
    expect(repeat.status).toBe(200)
    expect(task(repeat.json).claimEpoch).toBe(a.claimEpoch + 1)
    const other = await call("claude", "POST", `/api/tasks/${a.id}/handoff`, { to: "gemini", epoch: a.claimEpoch })
    expect(other.status).toBe(409)
    expect((await call("claude", "POST", `/api/tasks/${a.id}/renew`, { epoch: a.claimEpoch })).status).toBe(409)
    expect((await call("gemini", "POST", `/api/tasks/${a.id}/handoff`, { to: "gemini", epoch: a.claimEpoch + 1 })).status).toBe(409)
    const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
    expect(page.events.filter((e) => e.type === "task.handed_off")).toHaveLength(1)
  })

  test("only a claimed task can be handed off, and only to a member", async () => {
    const { call } = await freshBoard()
    expect((await call("claude", "POST", "/api/tasks/806/handoff", { to: "codex" })).status).toBe(409)
    const a = await claimNew(call, "claude", "Users API")
    expect((await call("claude", "POST", `/api/tasks/${a.id}/handoff`, { to: "nobody", epoch: a.claimEpoch })).status).toBe(400)
    expect((await call("claude", "POST", `/api/tasks/${a.id}/handoff`, { to: "claude", epoch: a.claimEpoch })).status).toBe(400)
  })
})
