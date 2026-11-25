import { describe, expect, test } from "bun:test"
import { Task, Thread } from "@flockr/contracts"
import { and, eq } from "drizzle-orm"
import { createApp } from "../src/app"
import { hmacSha256Hex } from "../src/code-hosts/host"
import { channels, events, members } from "../src/db/schema"
import { freshBoard } from "./harness"

const secret = "hook-secret-for-tests-only"
const repo = { full_name: "example-org/api" }
const pr = (extra: Record<string, unknown> = {}) => ({
  number: 12,
  title: "Add the users table",
  html_url: "https://github.com/example-org/api/pull/12",
  user: { login: "claude-bot" },
  head: { ref: "flockr/806" },
  merged: false,
  merge_commit_sha: null,
  ...extra,
})

async function board() {
  const fresh = await freshBoard()
  await fresh.db.update(channels).set({ repo: "github.com/example-org/api" }).where(eq(channels.id, "backend"))
  const app = createApp(fresh.db, { hooks: { secret } })
  let n = 0
  const deliver = async (event: string, payload: unknown, options: { delivery?: string; signWith?: string } = {}) => {
    const body = JSON.stringify(payload)
    const response = await app.request("/api/hooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": options.delivery ?? `d-${++n}`,
        "x-hub-signature-256": `sha256=${await hmacSha256Hex(options.signWith ?? secret, body)}`,
      },
      body,
    })
    return { status: response.status, json: (await response.json()) as Record<string, unknown> }
  }
  const thread = async () => Thread.parse((await fresh.call("simon", "GET", "/api/threads/806")).json)
  const texts = async () => (await thread()).entries.flatMap((entry) => ("text" in entry && typeof entry.text === "string" ? [entry.text] : []))
  return { ...fresh, deliver, thread, texts }
}

describe("GitHub sync (5e)", () => {
  test("a pull request on flockr/806 and its review and comments show in #806's thread, as the github bridge", async () => {
    const { deliver, texts, db, call } = await board()
    expect((await deliver("pull_request", { action: "opened", pull_request: pr(), repository: repo, sender: { login: "claude-bot" } })).json).toEqual({ outcome: "posted", task: 806 })
    await deliver("pull_request_review", { action: "submitted", review: { state: "changes_requested", body: "Index the email column", html_url: "https://github.com/example-org/api/pull/12#r1", user: { login: "simon" } }, pull_request: pr(), repository: repo })
    await deliver("issue_comment", { action: "created", issue: { number: 12, title: "Add the users table", html_url: "x", pull_request: {} }, comment: { body: "@claude done, please look", html_url: "https://github.com/example-org/api/pull/12#c2", user: { login: "claude-bot" } }, repository: repo })

    const all = (await texts()).join("\n")
    expect(all).toContain("**claude-bot** opened [#12 Add the users table](https://github.com/example-org/api/pull/12) from `flockr/806`")
    expect(all).toContain("**simon** asked for changes on [#12 Add the users table]")
    expect(all).toContain("> Index the email column")
    expect(all).toContain("> @claude done, please look")

    const [bridge] = await db.select().from(members).where(eq(members.name, "github"))
    expect(bridge?.kind).toBe("bridge")
    const mentioned = await db.select().from(events).where(and(eq(events.type, "mention.created")))
    expect(mentioned).toHaveLength(0)

    const merged = await deliver("pull_request", { action: "closed", pull_request: pr({ merged: true, merge_commit_sha: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0" }), repository: repo, sender: { login: "simon" } })
    expect(merged.status).toBe(200)
    const task = Task.parse((await call("simon", "GET", "/api/tasks/806")).json)
    expect(task.commits.map((commit) => commit.sha)).toContain("a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0")
    expect((await texts()).join("\n")).toContain("**simon** merged [#12")
  })

  test("a retried delivery posts once", async () => {
    const { deliver, texts } = await board()
    const payload = { action: "opened", pull_request: pr(), repository: repo, sender: { login: "claude-bot" } }
    const before = (await texts()).length
    expect((await deliver("pull_request", payload, { delivery: "same" })).json.outcome).toBe("posted")
    expect((await deliver("pull_request", payload, { delivery: "same" })).json.outcome).toBe("duplicate")
    expect((await texts()).length).toBe(before + 1)
  })

  test("a bad signature is refused; other repos, unlinked branches and pings are ignored", async () => {
    const { deliver, texts } = await board()
    const before = (await texts()).length
    const opened = { action: "opened", pull_request: pr(), repository: repo, sender: { login: "x" } }
    expect((await deliver("pull_request", opened, { signWith: "not-the-secret-at-all" })).status).toBe(401)
    expect((await deliver("pull_request", { ...opened, repository: { full_name: "someone/else" } })).json.outcome).toBe("ignored")
    expect((await deliver("pull_request", { ...opened, pull_request: pr({ head: { ref: "feature/login" } }) })).json.outcome).toBe("ignored")
    expect((await deliver("ping", { zen: "Keep it simple" })).status).toBe(202)
    expect((await texts()).length).toBe(before)
  })

  test("webhooks are off until FLOCKR_HOOK_SECRET is set", async () => {
    const { app } = await freshBoard()
    expect((await app.request("/api/hooks/github", { method: "POST", body: "{}" })).status).toBe(404)
  })
})
