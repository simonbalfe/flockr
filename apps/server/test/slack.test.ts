import { describe, expect, test } from "bun:test"
import { memberHeader, Thread } from "@flockr/contracts"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { createApp } from "../src/app"
import { drainJobs } from "../src/board/drain"
import type { BridgeSettings } from "../src/chat-bridges"
import { hmacSha256Hex } from "../src/code-hosts/host"
import { jobs, messages } from "../src/db/schema"
import { freshBoard } from "./harness"

const secret = "slack-signing-secret-for-tests"
const backendSlack = "C0BACKEND"

const SentBlocks = z.array(z.object({ type: z.string(), elements: z.array(z.object({ value: z.string() })).optional() }))

interface SlackPost {
  channel: string
  thread: string | null
  text: string
  values: string[]
  ts: string
}

function fakeSlack() {
  const posts: SlackPost[] = []
  const told: string[] = []
  let n = 0
  const handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input)
    const body = typeof init?.body === "string" ? init.body : ""
    if (url.startsWith("https://hooks.slack.test/")) {
      told.push(z.object({ text: z.string() }).parse(JSON.parse(body)).text)
      return Response.json({ ok: true })
    }
    if (!url.endsWith("/chat.postMessage")) return Response.json({ ok: false, error: "unknown_method" })
    const form = new URLSearchParams(body)
    const ts = `1764300000.${String(++n).padStart(6, "0")}`
    const blocks = form.get("blocks")
    const values = blocks ? SentBlocks.parse(JSON.parse(blocks)).flatMap((block) => block.elements?.map((element) => element.value) ?? []) : []
    posts.push({ channel: form.get("channel") ?? "", thread: form.get("thread_ts"), text: form.get("markdown_text") ?? form.get("text") ?? "", values, ts })
    return Response.json({ ok: true, channel: form.get("channel"), ts })
  }
  return { posts, told, fetch: Object.assign(handle, { preconnect: fetch.preconnect }) }
}

async function board() {
  const fresh = await freshBoard()
  const slack = fakeSlack()
  const bridges: BridgeSettings = { slack: { secret, token: "xoxb-test-token", fetch: slack.fetch } }
  const app = createApp(fresh.db, { bridges })
  const call = async (member: string, method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: { [memberHeader]: member, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, json: z.unknown().parse(await response.json()) }
  }
  const send = async (body: string, contentType: string, signWith = secret) => {
    const at = String(Math.floor(Date.now() / 1000))
    const response = await app.request("/api/hooks/slack", {
      method: "POST",
      headers: { "content-type": contentType, "x-slack-request-timestamp": at, "x-slack-signature": `v0=${await hmacSha256Hex(signWith, `v0:${at}:${body}`)}` },
      body,
    })
    return { status: response.status, json: z.unknown().parse(await response.json()) }
  }
  let events = 0
  const slackMessage = (message: { user: string; text: string; ts: string; thread?: string; id?: string }, signWith?: string) =>
    send(
      JSON.stringify({
        type: "event_callback",
        team_id: "T0TEAM",
        event_id: message.id ?? `Ev${++events}`,
        event: { type: "message", channel: backendSlack, channel_type: "channel", user: message.user, text: message.text, ts: message.ts, ...(message.thread ? { thread_ts: message.thread } : {}) },
      }),
      "application/json",
      signWith,
    )
  let presses = 0
  const press = (user: string, value: string) =>
    send(
      `payload=${encodeURIComponent(
        JSON.stringify({
          type: "block_actions",
          trigger_id: `trigger-${++presses}`,
          user: { id: user },
          channel: { id: backendSlack },
          container: { channel_id: backendSlack, message_ts: "1764300000.000001" },
          response_url: "https://hooks.slack.test/respond",
          actions: [{ action_id: "flockr_0", type: "button", value, action_ts: `1764300001.${presses}` }],
        }),
      )}`,
      "application/x-www-form-urlencoded",
    )
  const drain = () => drainJobs(fresh.db, { bridges })
  const thread = async (id: string) => Thread.parse((await call("simon", "GET", `/api/threads/${id}`)).json)
  expect((await call("simon", "PUT", `/api/bridges/slack/channels/backend`, { external: backendSlack })).status).toBe(200)
  expect((await call("simon", "PUT", `/api/bridges/slack/people/me`, { external: "U0SIMON" })).status).toBe(200)
  return { ...fresh, app, call, slack, slackMessage, press, send, drain, thread }
}

describe("Slack sync (5d)", () => {
  test("a retried Slack event changes nothing twice", async () => {
    const { slackMessage, db } = await board()
    const event = { user: "U0SIMON", text: "Ship the users table today", ts: "1764200000.000100", id: "EvSame" }
    const first = await slackMessage(event)
    expect(first.json).toMatchObject({ outcome: "posted", as: "simon" })
    expect((await slackMessage(event)).json).toEqual({ outcome: "duplicate" })
    const rows = await db.select().from(messages).where(and(eq(messages.channel, "backend"), eq(messages.body, event.text)))
    expect(rows).toHaveLength(1)
  })

  test("a bad signature is refused and changes nothing; with no secrets the hook is off", async () => {
    const { slackMessage, db, connection } = await board()
    const refused = await slackMessage({ user: "U0SIMON", text: "forged", ts: "1764200000.000200" }, "not-the-signing-secret")
    expect(refused.status).toBe(401)
    expect(await db.select().from(messages).where(eq(messages.body, "forged"))).toHaveLength(0)
    const off = await createApp(connection.db).request("/api/hooks/slack", { method: "POST", body: "{}" })
    expect(off.status).toBe(404)
  })

  test("an unlinked Slack user cannot answer a card; the linked person it is addressed to can", async () => {
    const { call, slack, press, drain, thread } = await board()
    const root = z.object({ message: z.object({ id: z.string() }) }).parse((await call("claude", "POST", "/api/channels/backend/messages", { text: "Which index for users.email?" })).json)
    expect((await call("claude", "POST", `/api/threads/${root.message.id}/ask`, { text: "Add a unique index?", options: ["Yes", "No"], to: "simon" })).status).toBe(200)
    await drain()
    const card = slack.posts.find((post) => post.values.length === 2)
    expect(card?.thread).toBe(slack.posts[0]?.ts ?? "none")
    const yes = card?.values[0] ?? ""

    expect((await press("U0EVE", yes)).json).toMatchObject({ outcome: "refused" })
    expect(slack.told.at(-1)).toContain("not linked")
    expect((await call("simon", "PUT", "/api/bridges/slack/people/me", { external: "U0SIMON" })).status).toBe(200)
    expect((await call("tim", "PUT", "/api/bridges/slack/people/me", { external: "U0TIM" })).status).toBe(200)
    expect((await press("U0TIM", yes)).json).toMatchObject({ outcome: "refused" })
    expect((await thread(root.message.id)).entries.some((entry) => entry.kind === "question" && entry.answer === null)).toBe(true)

    expect((await press("U0SIMON", yes)).json).toMatchObject({ outcome: "done", as: "simon" })
    expect((await thread(root.message.id)).entries.some((entry) => entry.kind === "question" && entry.answer === "Yes" && entry.answeredBy === "simon")).toBe(true)
  })

  test("nothing crosses orgs: shared and private channels cannot be linked, client people cannot link, nothing from them reaches Slack", async () => {
    const { call, db, drain, slack } = await board()
    expect((await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })).status).toBe(200)
    expect((await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })).status).toBe(200)
    expect((await call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })).status).toBe(200)
    expect((await call("simon", "PUT", "/api/channels/acme-site/members/ana")).status).toBe(200)
    expect((await call("simon", "POST", "/api/channels", { id: "secret-plans", visibility: "private" })).status).toBe(200)

    expect((await call("simon", "PUT", "/api/bridges/slack/channels/acme-site", { external: "C0ACME" })).status).toBe(403)
    expect((await call("simon", "PUT", "/api/bridges/slack/channels/secret-plans", { external: "C0SECRET" })).status).toBe(403)
    expect((await call("ana", "PUT", "/api/bridges/slack/people/me", { external: "U0ANA" })).status).toBe(403)
    expect((await call("ana", "PUT", "/api/bridges/slack/channels/backend", { external: "C0OTHER" })).status).toBe(403)
    expect((await call("claude", "PUT", "/api/bridges/slack/channels/platform", { external: "C0PLATFORM" })).status).toBe(403)

    await call("ana", "POST", "/api/channels/acme-site/messages", { text: "acme's private launch date" })
    await drain()
    expect(slack.posts.some((post) => post.text.includes("acme"))).toBe(false)
    expect((await db.select().from(jobs).where(eq(jobs.kind, "bridge"))).length).toBe(0)
    expect((await call("ana", "GET", "/api/bridges")).status).toBe(403)
  })

  test("a board reply reaches the linked Slack thread once, and a Slack reply is not echoed back", async () => {
    const { call, drain, slack, slackMessage, thread } = await board()
    const root = z.object({ message: z.object({ id: z.string() }) }).parse((await call("simon", "POST", "/api/channels/backend/messages", { text: "Who takes the users migration?" })).json)
    expect((await call("claude", "POST", `/api/threads/${root.message.id}/replies`, { text: "I will, after #806" })).status).toBe(200)
    await drain()
    await drain()
    const [top, replyPost, ...rest] = slack.posts
    expect(rest).toHaveLength(0)
    expect(top).toMatchObject({ channel: backendSlack, thread: null, text: "**simon**: Who takes the users migration?" })
    expect(replyPost).toMatchObject({ channel: backendSlack, thread: top?.ts ?? "none", text: "**claude**: I will, after #806" })

    expect((await slackMessage({ user: "U0EVE", text: "Thanks!", ts: "1764300009.000001", thread: top?.ts ?? "none" })).json).toMatchObject({ outcome: "posted", as: "slack" })
    await drain()
    expect(slack.posts).toHaveLength(2)
    const texts = (await thread(root.message.id)).entries.flatMap((entry) => ("text" in entry && typeof entry.text === "string" ? [entry.text] : []))
    expect(texts).toContain("**Slack user U0EVE**: Thanks!")
  })
})
