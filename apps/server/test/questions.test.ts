import { describe, expect, test } from "bun:test"
import { Inbox, ThreadQuestion } from "@flockr/contracts"
import { freshBoard } from "./harness"

const ask = { text: "Is email unique on users?", options: ["Yes", "No"] }

describe("questions between members (13d)", () => {
  test("a question addressed to codex stays open until codex answers it", async () => {
    const { call } = await freshBoard()
    const asked = ThreadQuestion.parse((await call("claude", "POST", "/api/threads/812/ask", { ...ask, to: "codex" })).json)
    expect(asked).toMatchObject({ to: "codex", answer: null })
    expect((await call("simon", "POST", "/api/threads/812/answer", { option: "Yes" })).status).toBe(403)
    expect((await call("gemini", "POST", "/api/threads/812/answer", { option: "Yes" })).status).toBe(403)
    const answered = ThreadQuestion.parse((await call("codex", "POST", "/api/threads/812/answer", { option: "Yes" })).json)
    expect(answered).toMatchObject({ answer: "Yes", answeredBy: "codex" })
  })

  test("a permission card needs a person even when addressed to an agent; an unaddressed question needs a person", async () => {
    const { call } = await freshBoard()
    const card = { ...ask, to: "codex", action: { tool: "Bash", command: "rm -rf dist" } }
    expect((await call("claude", "POST", "/api/threads/812/ask", card)).status).toBe(200)
    expect((await call("codex", "POST", "/api/threads/812/answer", { option: "Yes" })).status).toBe(403)
    expect((await call("simon", "POST", "/api/threads/812/answer", { option: "Yes" })).status).toBe(200)
    expect((await call("claude", "POST", "/api/threads/806/ask", ask)).status).toBe(200)
    expect((await call("codex", "POST", "/api/threads/806/answer", { option: "No" })).status).toBe(403)
    expect((await call("tim", "POST", "/api/threads/806/answer", { option: "No" })).status).toBe(200)
  })

  test("the addressed member must see the channel and cannot be the asker", async () => {
    const { call } = await freshBoard()
    await call("simon", "POST", "/api/orgs", { id: "globex", name: "Globex" })
    await call("simon", "POST", "/api/members", { name: "gus", kind: "person", org: "globex" })
    expect((await call("claude", "POST", "/api/threads/812/ask", { ...ask, to: "gus" })).status).toBe(400)
    expect((await call("claude", "POST", "/api/threads/812/ask", { ...ask, to: "claude" })).status).toBe(400)
  })

  test("each member's inbox lists the questions meant for them", async () => {
    const { call } = await freshBoard()
    await call("claude", "POST", "/api/threads/812/ask", { ...ask, to: "codex" })
    await call("claude", "POST", "/api/threads/806/ask", { ...ask, to: "gemini" })
    await call("claude", "POST", "/api/threads/814/ask", ask)
    const ids = async (member: string) => Inbox.parse((await call(member, "GET", "/api/inbox")).json).threadQuestions.map((q) => q.threadId)
    expect(await ids("codex")).toEqual(["812"])
    expect(await ids("gemini")).toEqual(["806"])
    expect(await ids("simon")).toEqual(["814"])
    expect(Inbox.parse((await call("codex", "GET", "/api/inbox")).json).reviews).toEqual([])
  })
})
