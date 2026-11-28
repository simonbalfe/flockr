import { describe, expect, test } from "bun:test"
import { ChannelDocument, DocumentVersion, EventPage, documentLimits } from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

const path = "/api/channels/backend/document"
const kindOf = (json: unknown) => z.object({ kind: z.string() }).parse(json).kind

describe("channel document (13b)", () => {
  test("starts empty at version 0; an edit names the version it replaces; every version stays readable", async () => {
    const { call } = await freshBoard()
    expect(ChannelDocument.parse((await call("claude", "GET", path)).json)).toMatchObject({ version: 0, text: "", editedBy: null })
    const first = ChannelDocument.parse((await call("simon", "PUT", path, { text: "Table first, then the API.", replaces: 0, note: "The plan" })).json)
    expect(first).toMatchObject({ version: 1, editedBy: "simon", note: "The plan" })
    const second = ChannelDocument.parse((await call("claude", "PUT", path, { text: "Table first, then the migration, then the API.", replaces: 1 })).json)
    expect(second.version).toBe(2)
    expect(ChannelDocument.parse((await call("codex", "GET", `${path}?version=1`)).json)).toMatchObject({ version: 1, text: "Table first, then the API.", current: false })
    const versions = z.array(DocumentVersion).parse((await call("codex", "GET", `${path}/versions`)).json)
    expect(versions.map((v) => v.version)).toEqual([2, 1])
    expect((await call("codex", "GET", `${path}?version=9`)).status).toBe(404)
  })

  test("two edits of the same version: exactly one wins, the other is stale", async () => {
    const { call } = await freshBoard()
    await call("simon", "PUT", path, { text: "v1", replaces: 0 })
    const results = await Promise.all([call("claude", "PUT", path, { text: "claude's plan", replaces: 1 }), call("codex", "PUT", path, { text: "codex's plan", replaces: 1 })])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const lost = results.find((r) => r.status === 409)
    expect(kindOf(lost?.json)).toBe("stale_version")
    expect(ChannelDocument.parse((await call("simon", "GET", path)).json).version).toBe(2)
  })

  test("a retried edit returns the version it made and writes one event", async () => {
    const { call } = await freshBoard()
    const body = { text: "Sign-up waits for the email plan.", replaces: 0 }
    expect(ChannelDocument.parse((await call("claude", "PUT", path, body)).json).version).toBe(1)
    const again = await call("claude", "PUT", path, body)
    expect(again.status).toBe(200)
    expect(ChannelDocument.parse(again.json).version).toBe(1)
    expect((await call("codex", "PUT", path, body)).status).toBe(409)
    const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
    expect(page.events.filter((e) => e.type === "channel.document_edited")).toHaveLength(1)
  })

  test("another org's agent edits the shared channel's document and cannot see ours; too long is refused", async () => {
    const { call } = await freshBoard()
    await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })
    await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })
    await call("simon", "POST", "/api/members", { name: "acme-bot", kind: "agent", org: "acme", owner: "ana" })
    await call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })
    await call("simon", "PUT", "/api/channels/acme-site/members/acme-bot")
    expect((await call("acme-bot", "PUT", "/api/channels/acme-site/document", { text: "Hero under 200 KB.", replaces: 0 })).status).toBe(200)
    expect((await call("acme-bot", "GET", path)).status).toBe(403)
    expect((await call("acme-bot", "PUT", path, { text: "mine now", replaces: 0 })).status).toBe(403)
    const page = EventPage.parse((await call("acme-bot", "GET", "/api/events?since=0&limit=1000")).json)
    expect(page.events.filter((e) => e.type === "channel.document_edited").map((e) => e.channel)).toEqual(["acme-site"])
    expect((await call("simon", "PUT", path, { text: "x".repeat(documentLimits.chars + 1), replaces: 0 })).status).toBe(400)
  })
})
