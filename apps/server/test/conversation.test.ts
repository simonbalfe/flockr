import { describe, expect, test } from "bun:test"
import { Activity, ActivityResult, EventPage, Inbox, PostMessageResult, Task, Thread, ThreadQuestion } from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

const permission = { text: "Run `date`?", detail: "Bash: date", options: ["Allow once", "Deny"] }

async function conversation() {
  const board = await freshBoard()
  const posted = PostMessageResult.parse((await board.call("simon", "POST", "/api/channels/backend/messages", { text: "@claude say hello" })).json)
  await board.call("claude", "POST", `/api/threads/${posted.message.id}/replies`, { text: "Hello." })
  return { ...board, thread: posted.message.id }
}

describe("questions in a thread", () => {
  test("an agent asks in a message thread, a person answers, the answer is a reply and the inbox empties", async () => {
    const { call, thread } = await conversation()
    const asked = await call("claude", "POST", `/api/threads/${thread}/ask`, permission)
    expect(asked.status).toBe(200)
    const question = ThreadQuestion.parse(asked.json)
    expect(question).toMatchObject({ threadId: thread, channel: "backend", who: "claude", answer: null })
    const inbox = Inbox.parse((await call("simon", "GET", "/api/inbox")).json)
    expect(inbox.threadQuestions.map((q) => q.id)).toEqual([question.id])
    expect((await call("claude", "POST", `/api/threads/${thread}/ask`, permission)).status).toBe(409)
    expect((await call("simon", "POST", `/api/threads/${thread}/answer`, { option: "Maybe" })).status).toBe(400)
    const answered = ThreadQuestion.parse((await call("simon", "POST", `/api/threads/${thread}/answer`, { option: "Allow once" })).json)
    expect(answered).toMatchObject({ id: question.id, answer: "Allow once", answeredBy: "simon" })
    const read = Thread.parse((await call("simon", "GET", `/api/threads/${thread}`)).json)
    expect(read.entries.map((e) => e.kind)).toEqual(["reply", "question", "reply"])
    expect(read.entries.at(-1)).toMatchObject({ who: "simon", text: "Allow once." })
    expect(Inbox.parse((await call("simon", "GET", "/api/inbox")).json).threadQuestions).toEqual([])
    const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
    expect(page.events.slice(-2).map((e) => e.type)).toEqual(["question.asked", "question.answered"])
    expect(page.events.at(-1)).toMatchObject({ threadId: thread, messageId: question.id, data: { option: "Allow once" } })
  })

  test("only a person answers, so an agent cannot approve its own question", async () => {
    const { call, thread } = await conversation()
    await call("claude", "POST", `/api/threads/${thread}/ask`, permission)
    expect((await call("claude", "POST", `/api/threads/${thread}/answer`, { option: "Allow once" })).status).toBe(403)
    expect((await call("codex", "POST", `/api/threads/${thread}/answer`, { option: "Allow once" })).status).toBe(403)
  })

  test("a question can live in a task thread without a claim, and the task question flow is untouched", async () => {
    const { call } = await freshBoard()
    const asked = ThreadQuestion.parse((await call("claude", "POST", "/api/threads/806/ask", permission)).json)
    expect(asked.threadId).toBe("806")
    expect(Task.parse((await call("simon", "GET", "/api/tasks/806")).json).question).toBeNull()
    expect((await call("simon", "POST", "/api/threads/806/answer", { option: "Deny" })).status).toBe(200)
    expect((await call("simon", "POST", "/api/threads/806/answer", { option: "Deny" })).status).toBe(400)
  })
})

describe("activity", () => {
  test("working shows in the list until it is cleared, keyed by the thread root", async () => {
    const { call, thread } = await conversation()
    const on = ActivityResult.parse((await call("claude", "PUT", `/api/threads/${thread}/activity`, { working: true })).json)
    expect(on.activity).toMatchObject({ member: "claude", threadId: thread, channel: "backend" })
    const again = ActivityResult.parse((await call("claude", "PUT", `/api/threads/${thread}/activity`, { working: true })).json)
    expect(again.activity?.since).toBe(on.activity?.since ?? "")
    expect(z.array(Activity).parse((await call("simon", "GET", "/api/activity")).json).map((a) => a.threadId)).toEqual([thread])
    const off = ActivityResult.parse((await call("claude", "PUT", `/api/threads/${thread}/activity`, { working: false })).json)
    expect(off.activity).toBeNull()
    expect(z.array(Activity).parse((await call("simon", "GET", "/api/activity")).json)).toEqual([])
  })

  test("activity writes nothing to the event log", async () => {
    const { call, thread } = await conversation()
    const head = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json).head
    await call("claude", "PUT", `/api/threads/${thread}/activity`, { working: true })
    await call("claude", "PUT", `/api/threads/${thread}/activity`, { working: false })
    expect(EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json).head).toBe(head)
  })
})

describe("declining a task", () => {
  test("releasing a ready task assigned to you unassigns it; keepAssignee keeps the binding", async () => {
    const { call } = await freshBoard()
    const made = Task.parse((await call("simon", "POST", "/api/tasks", { channel: "backend", title: "Add a health check", assignee: "claude" })).json)
    expect((await call("codex", "POST", `/api/tasks/${made.id}/release`, {})).status).toBe(409)
    const declined = Task.parse((await call("claude", "POST", `/api/tasks/${made.id}/release`, {})).json)
    expect(declined).toMatchObject({ state: "ready", assignee: null })
    const again = Task.parse((await call("simon", "POST", "/api/tasks", { channel: "backend", title: "Add a metrics page", assignee: "claude" })).json)
    const claimed = Task.parse((await call("claude", "POST", `/api/tasks/${again.id}/claim`)).json)
    const kept = Task.parse((await call("claude", "POST", `/api/tasks/${again.id}/release`, { epoch: claimed.claimEpoch, keepAssignee: true })).json)
    expect(kept).toMatchObject({ state: "ready", assignee: "claude", holder: null })
  })
})
