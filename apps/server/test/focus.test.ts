import { describe, expect, test } from "bun:test"
import { ActivityEntryResult, Focus, MyThread, Plan, PostMessageResult, Task } from "@flockr/contracts"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { tasks } from "../src/db/schema"
import { freshBoard } from "./harness"

type Board = Awaited<ReturnType<typeof freshBoard>>

const makeTask = async (board: Board, title: string, extra: Record<string, unknown> = {}) => Task.parse((await board.call("simon", "POST", "/api/tasks", { channel: "backend", title, ...extra })).json)
const claim = async (board: Board, who: string, id: number) => Task.parse((await board.call(who, "POST", `/api/tasks/${id}/claim`)).json)
const focusOf = async (board: Board, who = "simon") => Focus.parse((await board.call(who, "GET", "/api/focus")).json)
const ids = (list: { id: number }[]) => list.map((t) => t.id)

async function post(board: Board, who: string, text: string) {
  return PostMessageResult.parse((await board.call(who, "POST", "/api/channels/backend/messages", { text })).json).message.id
}
const reply = (board: Board, who: string, thread: string, text: string) => board.call(who, "POST", `/api/threads/${thread}/replies`, { text })
const tool = (name: string) => ({ type: "tool", name })

describe("focus (12a)", () => {
  test("needs you holds task questions, thread questions, reviews and blocked tasks", async () => {
    const board = await freshBoard()
    const asking = await makeTask(board, "Run the migration on prod")
    const askingClaim = await claim(board, "claude", asking.id)
    await board.call("claude", "POST", `/api/tasks/${asking.id}/ask`, { text: "Run it on prod?", options: ["Run it", "Not now"], epoch: askingClaim.claimEpoch })
    const reviewing = await makeTask(board, "Build the /users API")
    const reviewClaim = await claim(board, "codex", reviewing.id)
    await board.call("codex", "POST", `/api/tasks/${reviewing.id}/submit`, { epoch: reviewClaim.claimEpoch })
    const blocked = await makeTask(board, "Upgrade the email plan")
    await board.call("simon", "POST", `/api/tasks/${blocked.id}/block`, { reason: "Waiting on finance" })
    const root = await post(board, "simon", "Can sign-up take social accounts?")
    await board.call("claude", "POST", `/api/threads/${root}/ask`, { text: "Add Google sign-in?", options: ["Yes", "No"] })
    const plain = await makeTask(board, "Write the docs")

    const focus = await focusOf(board)
    expect(ids(focus.needsYou.questions)).toContain(asking.id)
    expect(ids(focus.needsYou.reviews)).toContain(reviewing.id)
    expect(ids(focus.needsYou.blocked)).toContain(blocked.id)
    expect(focus.needsYou.threadQuestions.map((q) => q.threadId)).toContain(root)
    const waiting = [...focus.needsYou.questions, ...focus.needsYou.reviews, ...focus.needsYou.blocked]
    expect(ids(waiting)).not.toContain(plain.id)
    expect(focus.needsYou.blocked.every((t) => t.state === "blocked")).toBe(true)
  })

  test("done today holds only tasks done since 00:00 UTC, newest first", async () => {
    const board = await freshBoard()
    const today = await makeTask(board, "Design the users table")
    const todayClaim = await claim(board, "claude", today.id)
    await board.call("claude", "POST", `/api/tasks/${today.id}/complete`, { epoch: todayClaim.claimEpoch })
    const yesterday = await makeTask(board, "Old migration")
    const yesterdayClaim = await claim(board, "claude", yesterday.id)
    await board.call("claude", "POST", `/api/tasks/${yesterday.id}/complete`, { epoch: yesterdayClaim.claimEpoch })
    await board.db
      .update(tasks)
      .set({ updatedAt: sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '1 minute'` })
      .where(eq(tasks.id, yesterday.id))
    const open = await makeTask(board, "Still open")

    const done = (await focusOf(board)).doneToday
    expect(ids(done)).toContain(today.id)
    expect(ids(done)).not.toContain(yesterday.id)
    expect(ids(done)).not.toContain(open.id)
    expect(done.every((t) => t.state === "done")).toBe(true)
  })

  test("running holds one line per run in progress with its step count and last steps", async () => {
    const board = await freshBoard()
    const task = await makeTask(board, "Build the /users API")
    await claim(board, "codex", task.id)
    const first = ActivityEntryResult.parse(
      (await board.call("codex", "POST", `/api/threads/${task.id}/activity-entries`, { title: "Reading", runId: "run-1", parts: [tool("read_file"), tool("grep")] })).json,
    ).entry
    await board.call("codex", "POST", `/api/activity-entries/${first.id}/updates`, { updates: [{ type: "run.finished", status: "ok" }] })
    await board.call("codex", "POST", `/api/threads/${task.id}/activity-entries`, { title: "Editing", runId: "run-1", parts: [tool("edit_file"), tool("bash"), tool("edit_file")] })
    const finished = await makeTask(board, "Finished work")
    const done = ActivityEntryResult.parse((await board.call("claude", "POST", `/api/threads/${finished.id}/activity-entries`, { title: "Done", parts: [tool("bash")] })).json).entry
    await board.call("claude", "POST", `/api/activity-entries/${done.id}/updates`, { updates: [{ type: "run.finished", status: "ok" }] })

    const running = (await focusOf(board)).running.filter((r) => r.taskId === task.id || r.taskId === finished.id)
    expect(running).toHaveLength(1)
    expect(running[0]).toMatchObject({ agent: "codex", taskId: task.id, threadId: String(task.id), title: "Build the /users API", steps: 5 })
    expect(running[0]?.recent.map((s) => s.text)).toEqual(["Using edit_file", "Using bash", "Using edit_file"])
    expect(running[0]?.leaseExpiresAt).not.toBeNull()
  })

  test("running lists every agent holding a claimed task, with no steps when it has no run, and leaves out people and other states", async () => {
    const board = await freshBoard()
    const idle = await makeTask(board, "Wire the sign-up form")
    await claim(board, "gemini", idle.id)
    const byPerson = await makeTask(board, "Call the email vendor")
    await claim(board, "tim", byPerson.id)
    const released = await makeTask(board, "Old work")
    const releasedClaim = await claim(board, "codex", released.id)
    await board.call("codex", "POST", `/api/tasks/${released.id}/release`, { epoch: releasedClaim.claimEpoch })

    const running = (await focusOf(board)).running
    const line = running.find((r) => r.taskId === idle.id)
    expect(line).toMatchObject({ agent: "gemini", threadId: String(idle.id), title: "Wire the sign-up form", steps: 0, recent: [] })
    expect(line?.leaseExpiresAt).not.toBeNull()
    expect(running.map((r) => r.taskId)).not.toContain(byPerson.id)
    expect(running.map((r) => r.taskId)).not.toContain(released.id)
    const claimedByAgents = (await board.call("simon", "GET", "/api/tasks?state=claimed")).json
    const agentHeld = z
      .array(Task)
      .parse(claimedByAgents)
      .filter((t) => t.holder !== null && ["claude", "codex", "gemini"].includes(t.holder))
    for (const task of agentHeld) expect(running.filter((r) => r.taskId === task.id)).toHaveLength(1)
  })

  test("open plans are listed newest first with progress", async () => {
    const board = await freshBoard()
    const older = Plan.parse((await board.call("simon", "POST", "/api/plans", { channel: "backend", title: "Users API" })).json)
    const newer = Plan.parse((await board.call("simon", "POST", "/api/plans", { channel: "platform", title: "Cold starts" })).json)
    const closed = Plan.parse((await board.call("simon", "POST", "/api/plans", { channel: "backend", title: "Old" })).json)
    await board.call("simon", "POST", `/api/plans/${closed.id}/close`)
    await makeTask(board, "Design the users table", { plan: older.id })
    const listed = (await focusOf(board)).plans
    const mine = listed.filter((p) => [older.id, newer.id, closed.id].includes(p.id))
    expect(mine.map((p) => p.id)).toEqual([newer.id, older.id])
    expect(mine[1]?.progress).toMatchObject({ total: 1, ready: 1 })
  })

  test("thread status takes the first that applies: needs you, running, blocked, unread, done, quiet", async () => {
    const board = await freshBoard()
    const status = async () => new Map(z.array(MyThread).parse((await board.call("simon", "GET", "/api/me/threads")).json).map((t) => [t.threadId, t.status]))

    const asked = await post(board, "simon", "Should sign-up take social accounts?")
    await reply(board, "claude", asked, "Looking")
    await board.call("claude", "POST", `/api/threads/${asked}/ask`, { text: "Add Google sign-in?", options: ["Yes", "No"] })

    const working = await post(board, "simon", "Profile the cold start")
    await reply(board, "codex", working, "On it")
    await board.call("codex", "POST", `/api/threads/${working}/activity-entries`, { title: "Profiling" })

    const quiet = await post(board, "simon", "Pick a table name")
    await reply(board, "claude", quiet, "users")
    await reply(board, "simon", quiet, "Thanks")

    const unread = await post(board, "simon", "Which region?")
    await reply(board, "claude", unread, "eu-west")

    const blockedTask = await makeTask(board, "Upgrade the email plan")
    await reply(board, "simon", String(blockedTask.id), "Asked finance")
    await board.call("simon", "POST", `/api/tasks/${blockedTask.id}/block`, { reason: "Waiting on finance" })
    await reply(board, "tim", String(blockedTask.id), "Still waiting")

    const runningBlocked = await makeTask(board, "Fix the flaky test")
    await reply(board, "simon", String(runningBlocked.id), "Please look")
    await board.call("simon", "POST", `/api/tasks/${runningBlocked.id}/block`, { reason: "Needs a repro" })
    await board.call("claude", "POST", `/api/threads/${runningBlocked.id}/activity-entries`, { title: "Reproducing" })

    const reviewTask = await makeTask(board, "Build the /users API")
    await reply(board, "simon", String(reviewTask.id), "Ship it")
    const reviewClaim = await claim(board, "codex", reviewTask.id)
    await board.call("codex", "POST", `/api/threads/${reviewTask.id}/activity-entries`, { title: "Testing" })
    await board.call("codex", "POST", `/api/tasks/${reviewTask.id}/submit`, { epoch: reviewClaim.claimEpoch })

    const doneTask = await makeTask(board, "Write the docs")
    await reply(board, "simon", String(doneTask.id), "Short please")
    const doneClaim = await claim(board, "claude", doneTask.id)
    await board.call("claude", "POST", `/api/tasks/${doneTask.id}/complete`, { epoch: doneClaim.claimEpoch })

    const seen = await status()
    expect(seen.get(asked)).toBe("needs_you")
    expect(seen.get(working)).toBe("running")
    expect(seen.get(String(runningBlocked.id))).toBe("running")
    expect(seen.get(String(blockedTask.id))).toBe("blocked")
    expect(seen.get(unread)).toBe("unread")
    expect(seen.get(String(reviewTask.id))).toBe("needs_you")
    expect(seen.get(String(doneTask.id))).toBe("done")
    expect(seen.get(quiet)).toBe("quiet")
  })
})
