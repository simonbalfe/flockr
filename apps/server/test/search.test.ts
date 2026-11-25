import { describe, expect, test } from "bun:test"
import { PostMessageResult, Reply, SearchResult, Task } from "@flockr/contracts"
import { freshBoard } from "./harness"

type Call = Awaited<ReturnType<typeof freshBoard>>["call"]

async function post(call: Call, channel: string, text: string): Promise<string> {
  return PostMessageResult.parse((await call("claude", "POST", `/api/channels/${channel}/messages`, { text })).json).message.id
}

async function search(call: Call, params: Record<string, string>) {
  const res = await call("simon", "GET", `/api/search?${new URLSearchParams(params)}`)
  expect(res.status).toBe(200)
  return SearchResult.parse(res.json).hits
}

const ids = (hits: Awaited<ReturnType<typeof search>>) => hits.map((h) => `${h.kind}:${h.id}`)

describe("search", () => {
  test("finds a message, a reply and a task by one word, with the word highlighted", async () => {
    const { call } = await freshBoard()
    const message = await post(call, "backend", "The flamingo cache needs warming")
    const reply = Reply.parse((await call("tim", "POST", `/api/threads/${message}/replies`, { text: "flamingo is warm now" })).json)
    const task = Task.parse((await call("simon", "POST", "/api/tasks", { channel: "platform", title: "Retire the flamingo cache" })).json)
    const hits = await search(call, { q: "flamingo" })
    expect(ids(hits).sort()).toEqual([`message:${message}`, `message:${reply.id}`, `task:${task.id}`].sort())
    expect(hits.find((h) => h.id === reply.id)).toMatchObject({ kind: "message", threadId: message, who: "tim", channel: "backend" })
    expect(hits.find((h) => h.id === task.id)).toMatchObject({ kind: "task", channel: "platform", who: "simon", state: "ready" })
    for (const hit of hits) expect(hit.snippet.filter((p) => p.match).map((p) => p.text.toLowerCase())).toContain("flamingo")
    expect(ids(await search(call, { q: "flaming" }))).toHaveLength(3)
  })

  test("the exact phrase ranks above the same words scattered", async () => {
    const { call } = await freshBoard()
    const scattered = await post(call, "backend", "The limiting factor is how we rate each zebra request")
    const exact = await post(call, "backend", "Add zebra rate limiting")
    const older = Task.parse((await call("simon", "POST", "/api/tasks", { channel: "backend", title: "Limiting zebra traffic", spec: "rate it" })).json)
    const hits = await search(call, { q: "zebra rate limiting" })
    expect(ids(hits)[0]).toBe(`message:${exact}`)
    expect(ids(hits)).toContain(`message:${scattered}`)
    expect(ids(hits)).toContain(`task:${older.id}`)
  })

  test("the channel filter keeps hits to one channel", async () => {
    const { call } = await freshBoard()
    const backend = await post(call, "backend", "pelican deploy is green")
    await post(call, "platform", "pelican deploy is red")
    await call("simon", "POST", "/api/tasks", { channel: "platform", title: "Fix the pelican deploy" })
    expect(ids(await search(call, { q: "pelican", channel: "backend" }))).toEqual([`message:${backend}`])
    expect(await search(call, { q: "pelican" })).toHaveLength(3)
    expect((await call("simon", "GET", "/api/search?q=pelican&channel=nowhere")).status).toBe(404)
  })

  test("a deleted message is never found", async () => {
    const { call } = await freshBoard()
    const gone = await post(call, "backend", "walrus password is hunter2")
    const kept = await post(call, "backend", "walrus notes are fine")
    expect((await call("claude", "DELETE", `/api/messages/${gone}`)).status).toBe(200)
    const hits = await search(call, { q: "walrus" })
    expect(ids(hits)).toEqual([`message:${kept}`])
    expect(JSON.stringify(hits)).not.toContain("hunter2")
  })
})
