import { describe, expect, test } from "bun:test"
import type { ActivityEntry, ActivityPart, Reply } from "@/api/types"
import { duration, splitWork, summarizeWork, workCounts } from "./work"

const at = (s: number) => new Date(Date.UTC(2026, 10, 24, 10, 0, s)).toISOString()

function entry(id: string, over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    kind: "activity",
    id,
    threadId: "m12",
    channel: "backend",
    who: "claude",
    at: at(0),
    title: "Add rate limiting",
    runId: null,
    status: "ok",
    revision: 1,
    updatedAt: at(30),
    endedAt: at(30),
    stopRequestedAt: null,
    parts: [],
    ...over,
  }
}

const reply: Reply = { kind: "reply", id: "m20", who: "claude", at: at(40), text: "Done.", deleted: false, mentions: [], labels: [], editedAt: null, replyTo: null }

describe("splitWork", () => {
  test("consecutive entries become one work block, a reply splits them", () => {
    const runs = splitWork([entry("m13"), entry("m14"), reply, entry("m21")])
    expect(runs.map((r) => (r.kind === "work" ? r.entries.map((e) => e.id) : r.item.id))).toEqual([["m13", "m14"], "m20", ["m21"]])
  })

  test("entries of two different runs stay apart", () => {
    const runs = splitWork([entry("m13", { runId: "a" }), entry("m14", { runId: "b" }), entry("m15", { runId: "b" })])
    expect(runs.map((r) => (r.kind === "work" ? r.entries.length : 0))).toEqual([1, 2])
  })
})

describe("summarizeWork", () => {
  const tool: ActivityPart = { type: "tool", id: "t1", name: "edit_file", input: {}, output: "", status: "ok", startedAt: at(1), durationMs: 200 }
  const command: ActivityPart = { type: "terminal", id: "c1", command: "bun test", cwd: null, output: "", exitCode: null, status: "running", startedAt: at(5), durationMs: null }
  const tests: ActivityPart = { type: "tests", id: "x1", command: null, passed: 41, failed: 2, skipped: 0, suites: [], failures: [], status: "error", startedAt: at(6), durationMs: 900 }
  const files: ActivityPart = { type: "files", id: "f1", files: [{ path: "a.ts", added: 3, removed: 1, diff: null }, { path: "b.ts", added: 1, removed: 0, diff: null }] }

  test("a running block leads with the current step and counts time to now", () => {
    const summary = summarizeWork([entry("m13", { parts: [tool] }), entry("m14", { status: "running", endedAt: null, parts: [command] })], Date.parse(at(75)))
    expect(summary).toMatchObject({ status: "running", headline: "Running bun test", steps: 2, failed: 0, durationMs: 75_000 })
  })

  test("a finished block shows the worst status, failures and the counts", () => {
    const summary = summarizeWork([entry("m13", { parts: [tool, tests, files] }), entry("m14", { status: "error", parts: [] })], Date.parse(at(500)))
    expect(summary).toMatchObject({ status: "error", headline: "Add rate limiting", failed: 1, durationMs: 30_000 })
    expect(summary.detail).toBe("1 tool call · 1 test run · 2 files changed")
  })

  test("a stop request shows while the run is still going", () => {
    expect(summarizeWork([entry("m13", { status: "running", stopRequestedAt: at(9) })], Date.parse(at(10))).stopRequested).toBe(true)
  })

  test("counts and durations read plainly", () => {
    expect(workCounts([command, command])).toBe("2 commands")
    expect([duration(400), duration(12_000), duration(134_000), duration(3_780_000)]).toEqual(["<1s", "12s", "2m 14s", "1h 3m"])
  })
})
