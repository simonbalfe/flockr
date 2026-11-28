import { describe, expect, test } from "bun:test"
import { FeedItem, ScheduledPost } from "@flockr/contracts"
import { z } from "zod"
import { drainJobs } from "../src/board/drain"
import { freshBoard } from "./harness"

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString()
const later = () => new Date(Date.now() + 2 * 3_600_000)

type Call = Awaited<ReturnType<typeof freshBoard>>["call"]
const texts = async (call: Call, channel: string) =>
  z
    .array(FeedItem)
    .parse((await call("simon", "GET", `/api/channels/${channel}/messages`)).json)
    .flatMap((item) => (item.kind === "text" ? [`${item.who}: ${item.text}`] : []))

describe("scheduled posts (13h)", () => {
  test("a post scheduled for later posts as its author once its time comes, and only once", async () => {
    const { call, db } = await freshBoard()
    const scheduled = ScheduledPost.parse((await call("simon", "POST", "/api/channels/backend/scheduled", { text: "Standup in 5", at: inAnHour(), key: "standup-1" })).json)
    expect(scheduled).toMatchObject({ state: "scheduled", by: "simon", messageId: null })
    const again = ScheduledPost.parse((await call("simon", "POST", "/api/channels/backend/scheduled", { text: "Standup in 5", at: scheduled.at, key: "standup-1" })).json)
    expect(again.id).toBe(scheduled.id)
    expect(z.array(ScheduledPost).parse((await call("simon", "GET", "/api/me/scheduled")).json).map((s) => s.id)).toEqual([scheduled.id])
    await drainJobs(db)
    expect(await texts(call, "backend")).not.toContain("simon: Standup in 5")
    await drainJobs(db, { now: later() })
    await drainJobs(db, { now: later() })
    expect((await texts(call, "backend")).filter((t) => t === "simon: Standup in 5")).toHaveLength(1)
    expect(z.array(ScheduledPost).parse((await call("simon", "GET", "/api/me/scheduled")).json)).toEqual([])
    expect((await call("simon", "POST", `/api/channels/backend/scheduled/${scheduled.id}/cancel`)).status).toBe(409)
  })

  test("only the author cancels, before it posts; a canceled post never posts", async () => {
    const { call, db } = await freshBoard()
    const scheduled = ScheduledPost.parse((await call("claude", "POST", "/api/channels/backend/scheduled", { text: "Deploy window opens", at: inAnHour() })).json)
    expect((await call("simon", "POST", `/api/channels/backend/scheduled/${scheduled.id}/cancel`)).status).toBe(403)
    expect((await call("claude", "POST", `/api/channels/platform/scheduled/${scheduled.id}/cancel`)).status).toBe(404)
    expect(ScheduledPost.parse((await call("claude", "POST", `/api/channels/backend/scheduled/${scheduled.id}/cancel`)).json).state).toBe("canceled")
    expect((await call("claude", "POST", `/api/channels/backend/scheduled/${scheduled.id}/cancel`)).status).toBe(200)
    await drainJobs(db, { now: later() })
    expect(await texts(call, "backend")).not.toContain("claude: Deploy window opens")
  })

  test("a time in the past is refused; an author who lost the channel never posts", async () => {
    const { call, db } = await freshBoard()
    expect((await call("simon", "POST", "/api/channels/backend/scheduled", { text: "late", at: new Date(Date.now() - 60_000).toISOString() })).status).toBe(400)
    await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })
    await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })
    await call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })
    await call("simon", "PUT", "/api/channels/acme-site/members/ana")
    expect((await call("ana", "POST", "/api/channels/acme-site/scheduled", { text: "Launch day", at: inAnHour() })).status).toBe(200)
    expect((await call("ana", "POST", "/api/channels/backend/scheduled", { text: "sneaky", at: inAnHour() })).status).toBe(403)
    await call("simon", "DELETE", "/api/channels/acme-site/members/ana")
    await drainJobs(db, { now: later() })
    expect(await texts(call, "acme-site")).not.toContain("ana: Launch day")
  })
})
