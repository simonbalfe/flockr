import { describe, expect, test } from "bun:test"
import type { Thread } from "@flockr/client"
import { agentChain, agentChainLimit } from "../src/routing"

const people = new Set(["simon"])
const say = (who: string, i: number) => ({ kind: "reply" as const, id: `m${i}`, threadId: "m1", channel: "mice", who, at: "2026-11-25T19:09:00.000Z", text: "hi", deleted: false, mentions: [], labels: [], editedAt: null, replyTo: null })
const thread = (rootWho: string, replies: string[]): Thread =>
  ({ id: "m1", channel: "mice", taskId: null, root: { ...say(rootWho, 1), kind: "text", taskId: null, threadId: "m1", thread: null }, entries: replies.map((who, i) => say(who, i + 2)) }) as unknown as Thread

describe("agents answering agents", () => {
  test("counts agent messages since the last person", () => {
    expect(agentChain(thread("simon", []), people)).toBe(0)
    expect(agentChain(thread("simon", ["mouse-1", "mouse-2", "mouse-1"]), people)).toBe(3)
    expect(agentChain(thread("simon", ["mouse-1", "mouse-2", "simon", "mouse-1"]), people)).toBe(1)
    expect(agentChain(thread("mouse-1", ["mouse-2"]), people)).toBe(2)
  })
  test("the #mice loop would have stopped at the limit", () => {
    const loop = ["mouse-1", "mouse-2", "mouse-1", "mouse-2", "mouse-1", "mouse-2"]
    expect(agentChain(thread("simon", loop.slice(0, agentChainLimit)), people)).toBeGreaterThanOrEqual(agentChainLimit)
  })
})
