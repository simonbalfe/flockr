import { describe, expect, test } from "bun:test"
import { ChannelReader, EventPage, PostMessageResult } from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

async function sharedBoard() {
  const board = await freshBoard()
  const { call } = board
  await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })
  await call("simon", "POST", "/api/orgs", { id: "globex", name: "Globex" })
  await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })
  await call("simon", "POST", "/api/members", { name: "acme-bot", kind: "agent", org: "acme", owner: "ana" })
  await call("simon", "POST", "/api/members", { name: "gus", kind: "person", org: "globex" })
  await call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })
  for (const name of ["ana", "acme-bot"]) await call("simon", "PUT", `/api/channels/acme-site/members/${name}`)
  return board
}

const readers = async (call: Awaited<ReturnType<typeof freshBoard>>["call"], who = "simon") => z.array(ChannelReader).parse((await call(who, "GET", "/api/channels/acme-site/readers")).json)

describe("read cursors and backlog (13e)", () => {
  test("everyone who sees a shared channel is listed across orgs, and nobody else", async () => {
    const { call } = await sharedBoard()
    const names = (await readers(call)).map((r) => r.member)
    expect(names).toEqual(expect.arrayContaining(["simon", "ana", "acme-bot", "claude", "codex"]))
    expect(names).not.toContain("gus")
    expect((await call("gus", "GET", "/api/channels/acme-site/readers")).status).toBe(403)
    expect((await call("acme-bot", "GET", "/api/channels/acme-site/readers")).status).toBe(200)
    expect((await call("acme-bot", "GET", "/api/channels/backend/readers")).status).toBe(403)
  })

  test("backlog and behindSince follow the cursor, which moves only as far as upTo and never back", async () => {
    const { call } = await sharedBoard()
    const first = PostMessageResult.parse((await call("simon", "POST", "/api/channels/acme-site/messages", { text: "New plan in the doc" })).json).message
    await call("simon", "POST", "/api/channels/acme-site/messages", { text: "Hero under 200 KB" })
    const bot = async () => (await readers(call)).find((r) => r.member === "acme-bot")
    expect(await bot()).toMatchObject({ backlog: 2, behindSince: first.at, lastReadId: null })
    expect((await call("acme-bot", "POST", `/api/channels/acme-site/read?upTo=${first.id}`)).status).toBe(200)
    expect(await bot()).toMatchObject({ backlog: 1, lastReadId: first.id })
    await call("acme-bot", "POST", "/api/channels/acme-site/read")
    expect(await bot()).toMatchObject({ backlog: 0, behindSince: null })
    const before = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json).events.filter((e) => e.type === "channel.read").length
    await call("acme-bot", "POST", `/api/channels/acme-site/read?upTo=${first.id}`)
    await call("acme-bot", "POST", "/api/channels/acme-site/read")
    const after = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json).events.filter((e) => e.type === "channel.read").length
    expect(after).toBe(before)
    expect(await bot()).toMatchObject({ backlog: 0 })
    expect((await readers(call))[0]?.backlog).toBeGreaterThan(0)
  })
})
