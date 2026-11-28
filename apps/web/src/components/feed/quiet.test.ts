import { describe, expect, test } from "bun:test"
import type { FeedItem, MemberKind, Task, TextMessage } from "@/api/types"
import { hiddenRunLabel, quietFeed, type NeedsYou, type QuietContext } from "./quiet"

const kinds: Record<string, MemberKind> = { simon: "person", tim: "person", lead: "agent", claude: "agent", codex: "agent", brief: "watcher" }

const at = (minute: number) => new Date(Date.UTC(2026, 10, 25, 9, minute)).toISOString()

function text(id: string, who: string, body: string, over: Partial<TextMessage> = {}): TextMessage {
  const mentions = [...body.matchAll(/@([a-z]+)/g)].flatMap((m) => (m[1] ? [m[1]] : []))
  return { kind: "text", id, channel: "backend", who, at: at(Number(id.slice(1))), text: body, deleted: false, mentions, labels: [], editedAt: null, taskId: null, threadId: id, thread: null, blocks: [], ...over }
}

function task(id: number, state: Task["state"]): Task {
  return {
    id,
    title: `Task ${id}`,
    channel: "backend",
    kind: "task",
    state,
    needs: [],
    labels: [],
    assignee: null,
    holder: null,
    leaseExpiresAt: null,
    claimEpoch: 0,
    spec: null,
    branch: `flockr/${id}`,
    commits: [],
    reason: null,
    question: null,
    replyCount: 0,
    planId: null,
    reviewer: null,
    reviewCommit: null,
    createdAt: at(0),
  }
}

const noNeeds: NeedsYou = { tasks: new Set(), threads: new Set() }

function context(over: Partial<QuietContext> = {}): QuietContext {
  return { kindOf: (name) => kinds[name], tasks: new Map(), needsYou: noNeeds, ...over }
}

const shape = (entries: FeedItem[], ctx: QuietContext) => quietFeed(entries, ctx).map((p) => `${p.kind}:${p.entries.map((e) => e.id).join(",")}`)

describe("quietFeed", () => {
  test("shows people and the agent a person asked, collapses agent-to-agent chatter", () => {
    const feed = [
      text("m1", "simon", "@lead we need a users API"),
      text("m2", "lead", "Plan: Users API, 4 tasks"),
      text("m3", "codex", "Claimed #806"),
      text("m4", "claude", "@codex is email unique?"),
      text("m5", "codex", "Yes, citext"),
      text("m6", "codex", "#806 is ready for review", { taskId: 806, threadId: null }),
    ]
    const ctx = context({ tasks: new Map([[806, task(806, "review")]]) })
    expect(shape(feed, ctx)).toEqual(["shown:m1,m2", "hidden:m3,m4,m5", "shown:m6"])
  })

  test("an agent answers a person only once per message", () => {
    const feed = [text("m1", "simon", "@lead plan this"), text("m2", "lead", "On it"), text("m3", "lead", "Made task #806")]
    expect(shape(feed, context())).toEqual(["shown:m1,m2", "hidden:m3"])
  })

  test("an agent message that mentions a person or whose thread needs you stays", () => {
    const feed = [text("m1", "claude", "@tim the backups moved"), text("m2", "claude", "Dry run is clean"), text("m3", "codex", "Reading the schema")]
    const ctx = context({ needsYou: { tasks: new Set(), threads: new Set(["m2"]) } })
    expect(shape(feed, ctx)).toEqual(["shown:m1,m2", "hidden:m3"])
  })

  test("questions stay, agent events and task cards that need nobody collapse", () => {
    const feed: FeedItem[] = [
      { kind: "ask", id: "m1", channel: "backend", who: "claude", at: at(1), taskId: 808 },
      { kind: "event", id: "e2", who: "codex", at: at(2), text: "claimed #812", system: false, blocks: [] },
      { kind: "task", id: "m3", channel: "backend", who: "lead", at: at(3), taskId: 812 },
      { kind: "task", id: "m4", channel: "backend", who: "lead", at: at(4), taskId: 815 },
      text("m5", "brief", "Morning brief"),
    ]
    const ctx = context({ tasks: new Map([[812, task(812, "claimed")], [815, task(815, "blocked")]]) })
    expect(shape(feed, ctx)).toEqual(["shown:m1", "hidden:e2,m3", "shown:m4,m5"])
  })

  test("names the run by its size", () => {
    expect(hiddenRunLabel([text("m1", "codex", "a")])).toBe("1 agent message")
    expect(hiddenRunLabel([text("m1", "codex", "a"), text("m2", "codex", "b"), text("m3", "claude", "c")])).toBe("3 agent messages")
  })
})
