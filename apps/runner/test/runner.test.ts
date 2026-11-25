import { describe, expect, test } from "bun:test"
import { memoryBlock } from "../src/memory"
import { event, member, memoryItem, messageThread, reply, setup, task } from "./fakes"

const mention = (thread: string, actor = "simon") => event({ type: "message.posted", actor, messageId: thread, threadId: thread, data: { mentions: [member] } })
const replied = (thread: string, id: string, actor = "simon") => event({ type: "reply.posted", actor, threadId: thread, messageId: id, data: { mentions: [] } })

describe("conversations", () => {
  test("a mention starts a session in the channel's folder and the final text becomes the reply", async () => {
    const { runner, board, started, sessions } = setup()
    board.threads.set("m10", messageThread("m10", "simon", "@claude say hello"))
    await runner.receive(mention("m10"))
    expect(started).toHaveLength(1)
    expect(started[0]?.spec).toMatchObject({ folder: "/tmp/flockr-general", resumeId: null })
    expect(started[0]?.spec.prompt).toContain("simon: @claude say hello")
    expect(started[0]?.spec.bridge.env.FLOCKR_THREAD).toBe("m10")
    expect(sessions.value()).toEqual({ "claude:m10": { harness: "fake", id: "session-1" } })
    started[0]?.end({ kind: "finished", text: "Hello there." })
    await runner.idle()
    await runner.idle()
    expect(board.calls).toEqual(["entry m10: Answering", "finish e-m10 ok", "reply m10: Hello there."])
  })

  test("steps the harness reports reach the entry in batches, all of them before the run is finished", async () => {
    const { runner, board, started, fire } = setup()
    board.threads.set("m10", messageThread("m10", "simon", "@claude say hello"))
    await runner.receive(mention("m10"))
    const report = started[0]?.spec.activity
    if (!report) throw new Error("no session")
    report([{ type: "part.set", part: { type: "reasoning", id: "r1", text: "Hello is short.", status: "ok" } }])
    report([{ type: "part.set", part: { type: "tool", id: "t1", name: "Read", status: "running" } }])
    fire(500)
    await runner.idle()
    report([{ type: "part.finished", partId: "t1", status: "ok" }])
    started[0]?.end({ kind: "finished", text: "Hello there." })
    await runner.idle()
    await runner.idle()
    expect(board.calls).toEqual(["entry m10: Answering", "update e-m10: part.set, part.set", "update e-m10: part.finished", "finish e-m10 ok", "reply m10: Hello there."])
  })

  test("a later reply without a mention resumes the stored session; a reply during a run goes into it", async () => {
    const { runner, board, started } = setup()
    board.threads.set("m10", messageThread("m10", "simon", "@claude say hello"))
    await runner.receive(mention("m10"))
    started[0]?.end({ kind: "finished", text: "Hello." })
    await runner.idle()
    await runner.idle()
    const thread = board.threads.get("m10")
    if (!thread) throw new Error("thread missing")
    board.threads.set("m10", { ...thread, entries: [...thread.entries, reply("m12", "simon", "and in French?")] })
    await runner.receive(replied("m10", "m12"))
    expect(started).toHaveLength(2)
    expect(started[1]?.spec.resumeId).toBe("session-1")
    expect(started[1]?.spec.prompt).toContain("and in French?")
    const again = board.threads.get("m10")
    if (!again) throw new Error("thread missing")
    board.threads.set("m10", { ...again, entries: [...again.entries, reply("m13", "simon", "shorter please")] })
    await runner.receive(replied("m10", "m13"))
    expect(started).toHaveLength(2)
    expect(started[1]?.sent[0]).toContain("shorter please")
  })

  test("a reply in a thread the member never joined is ignored, and so are its own replies", async () => {
    const { runner, board, started } = setup()
    board.threads.set("m20", messageThread("m20", "simon", "lunch?", [reply("m21", "tim", "yes")]))
    await runner.receive(replied("m20", "m21", "tim"))
    board.threads.set("m10", messageThread("m10", "simon", "@claude hi", [reply("m11", member, "Hi.")]))
    await runner.receive(replied("m10", "m11", member))
    expect(started).toHaveLength(0)
  })

  test("a channel with no override uses the agent's folder; a missing folder gets one notice, no session and an error", async () => {
    const { runner, board, started, problems } = setup({ config: { channels: {} } })
    board.threads.set("m10", messageThread("m10", "simon", "@claude say hello"))
    await runner.receive(mention("m10"))
    expect(started[0]?.spec.folder).toBe("/tmp/flockr-agent")
    const missing = setup({ config: { folderExists: () => false } })
    missing.board.threads.set("m10", messageThread("m10", "simon", "@claude say hello"))
    await missing.runner.receive(mention("m10"))
    await missing.runner.receive(mention("m10"))
    expect(missing.started).toHaveLength(0)
    expect(missing.board.calls).toEqual(["reply m10: My folder /tmp/flockr-general does not exist on this machine, so I cannot work here. Fix it in my agent settings."])
    expect(missing.problems).toEqual(["Folder /tmp/flockr-general not found", "Folder /tmp/flockr-general not found"])
    expect(problems).toEqual([])
  })

  test("the agent's permissions reach the harness and the bridge", async () => {
    const { runner, board, started } = setup({ config: { settings: { folder: "/tmp/a", permissions: "read-only", personality: "You review code.", model: null } } })
    board.threads.set("m10", messageThread("m10", "simon", "@claude look"))
    await runner.receive(mention("m10"))
    expect(started[0]?.spec.rule).toEqual({ read: "allow", edit: "deny", command: "ask", other: "ask" })
    expect(started[0]?.spec.bridge.env.FLOCKR_PERMISSIONS).toBe("read-only")
    expect(started[0]?.spec.instructions).toContain("You review code.")
  })

  test("a failed run posts one short reply", async () => {
    const { runner, board, started } = setup()
    board.threads.set("m10", messageThread("m10", "simon", "@claude say hello"))
    await runner.receive(mention("m10"))
    started[0]?.end({ kind: "failed", error: "exit code 1" })
    await runner.idle()
    await runner.idle()
    expect(board.calls.filter((c) => c.startsWith("reply"))).toEqual(["reply m10: The run failed: exit code 1"])
  })

  test("maxSessions queues the next conversation until a run ends", async () => {
    const { runner, board, started } = setup({ config: { maxSessions: 1 } })
    board.threads.set("m10", messageThread("m10", "simon", "@claude one"))
    board.threads.set("m30", messageThread("m30", "simon", "@claude two"))
    await runner.receive(mention("m10"))
    await runner.receive(mention("m30"))
    expect(started).toHaveLength(1)
    started[0]?.end({ kind: "finished", text: "One." })
    await runner.idle()
    await runner.idle()
    expect(started).toHaveLength(2)
    expect(started[1]?.spec.prompt).toContain("@claude two")
  })
})

describe("tasks and claims", () => {
  test("a ready task assigned to the member is claimed with its epoch and submitted with it", async () => {
    const { runner, board, started, epochs } = setup()
    board.tasks.set(830, task({ id: 830, claimEpoch: 4 }))
    await runner.receive(event({ type: "task.created", actor: "simon", taskId: 830, threadId: "830", data: { state: "ready" } }))
    expect(board.calls[0]).toBe("claim 830 epoch 5")
    expect(epochs.all.get(830)).toBe(5)
    expect(started[0]?.spec.prompt).toContain("flockr tasks submit 830")
    started[0]?.end({ kind: "finished", text: "Added /health." })
    await runner.idle()
    await runner.idle()
    expect(board.calls).toContain("submit 830 epoch 5: Added /health.")
    expect(board.tasks.get(830)?.state).toBe("review")
  })

  test("tasks for someone else or unassigned are never claimed", async () => {
    const { runner, board, started } = setup()
    board.tasks.set(830, task({ id: 830, assignee: "codex" }))
    board.tasks.set(832, task({ id: 832, assignee: null }))
    await runner.receive(event({ type: "task.created", actor: "simon", taskId: 830, data: { state: "ready" } }))
    await runner.receive(event({ type: "task.created", actor: "simon", taskId: 832, data: { state: "ready" } }))
    expect(started).toHaveLength(0)
    expect(board.calls).toEqual([])
  })

  test("losing the race for a claim starts nothing", async () => {
    const { runner, board, started } = setup()
    board.tasks.set(830, task({ id: 830, state: "claimed", holder: "codex" }))
    await runner.receive(event({ type: "task.ready", actor: "simon", taskId: 830, data: { state: "ready" } }))
    expect(started).toHaveLength(0)
  })

  test("a person taking the task away stops the session and submits nothing", async () => {
    const { runner, board, started } = setup()
    board.tasks.set(830, task({ id: 830 }))
    await runner.receive(event({ type: "task.created", actor: "simon", taskId: 830, data: { state: "ready" } }))
    board.tasks.set(830, task({ id: 830, state: "ready", holder: null, claimEpoch: 1 }))
    await runner.receive(event({ type: "task.released", actor: "simon", taskId: 830, data: { state: "ready" } }))
    await runner.idle()
    expect(started[0]?.stopped).toBe(true)
    expect(board.calls.some((c) => c.startsWith("submit"))).toBe(false)
  })

  test("a refused renew stops the session; the time limit replies and releases", async () => {
    const first = setup()
    first.board.tasks.set(830, task({ id: 830 }))
    await first.runner.receive(event({ type: "task.created", actor: "simon", taskId: 830, data: { state: "ready" } }))
    first.board.failRenew()
    first.fire(5 * 60_000)
    await first.runner.idle()
    expect(first.started[0]?.stopped).toBe(true)

    const second = setup()
    second.board.tasks.set(840, task({ id: 840 }))
    await second.runner.receive(event({ type: "task.created", actor: "simon", taskId: 840, data: { state: "ready" } }))
    second.fire(30 * 60_000)
    await second.runner.idle()
    await second.runner.idle()
    await second.runner.idle()
    expect(second.board.calls).toContain("reply 840: Stopped after 30 minutes, the runner's time limit for one run.")
    expect(second.board.calls).toContain("release 840 epoch 1")
    expect(second.board.tasks.get(840)).toMatchObject({ state: "ready", assignee: null })
  })

  test("a crashed work run blocks the task with the short error", async () => {
    const { runner, board, started } = setup()
    board.tasks.set(830, task({ id: 830 }))
    await runner.receive(event({ type: "task.created", actor: "simon", taskId: 830, data: { state: "ready" } }))
    started[0]?.end({ kind: "failed", error: "exit code 2" })
    await runner.idle()
    await runner.idle()
    expect(board.calls).toContain("block 830 epoch 1: The run failed: exit code 2")
  })

  test("shutdown stops sessions and releases claims but keeps the assignment", async () => {
    const { runner, board, started } = setup()
    board.tasks.set(830, task({ id: 830 }))
    await runner.receive(event({ type: "task.created", actor: "simon", taskId: 830, data: { state: "ready" } }))
    await runner.shutdown()
    expect(started[0]?.stopped).toBe(true)
    expect(board.calls).toContain("release 830 epoch 1 keep")
    expect(board.tasks.get(830)).toMatchObject({ state: "ready", assignee: member })
  })

  test("start picks up ready tasks assigned to the member", async () => {
    const { runner, board, started } = setup()
    board.tasks.set(830, task({ id: 830 }))
    await runner.start()
    expect(started).toHaveLength(1)
  })
})

describe("stopping from the board", () => {
  test("a stop request for the member stops its run in that thread; the entry ends stopped", async () => {
    const { runner, board, started } = setup()
    board.threads.set("m10", messageThread("m10", "simon", "@claude say hello"))
    await runner.receive(mention("m10"))
    await runner.receive(event({ type: "run.stop_requested", actor: "simon", threadId: "m30", data: { member } }))
    await runner.receive(event({ type: "run.stop_requested", actor: "simon", threadId: "m10", data: { member: "codex" } }))
    expect(started[0]?.stopped).toBe(false)
    await runner.receive(event({ type: "run.stop_requested", actor: "simon", threadId: "m10", data: { member } }))
    await runner.idle()
    await runner.idle()
    expect(started[0]?.stopped).toBe(true)
    expect(board.calls).toContain("finish e-m10 stopped")
    expect(board.calls.some((c) => c.startsWith("reply"))).toBe(false)
  })

  test("a stopped work run blocks its task so it does not start again", async () => {
    const { runner, board, started } = setup()
    board.tasks.set(830, task({ id: 830 }))
    await runner.receive(event({ type: "task.created", actor: "simon", taskId: 830, data: { state: "ready" } }))
    await runner.receive(event({ type: "run.stop_requested", actor: "simon", threadId: "830", data: { member } }))
    await runner.idle()
    await runner.idle()
    expect(started[0]?.stopped).toBe(true)
    expect(board.calls).toContain("block 830 epoch 1: Stopped because a person asked to stop the run.")
  })
})

describe("the harness interface", () => {
  test("without streaming, a reply during a run waits and resumes the session after it", async () => {
    const { runner, board, started } = setup({ capabilities: { resume: true, streaming: false } })
    board.threads.set("m10", messageThread("m10", "simon", "@claude say hello", [reply("m12", "simon", "and more")]))
    await runner.receive(mention("m10"))
    await runner.receive(replied("m10", "m12"))
    expect(started[0]?.sent).toEqual([])
    started[0]?.end({ kind: "finished", text: "Hello." })
    await runner.idle()
    await runner.idle()
    await runner.idle()
    expect(started).toHaveLength(2)
    expect(started[1]?.spec.resumeId).toBe("session-1")
    expect(started[1]?.spec.prompt).toContain("and more")
  })

  test("without resume, a later reply starts fresh with the whole thread", async () => {
    const { runner, board, started } = setup({ capabilities: { resume: false, streaming: true } })
    board.threads.set("m10", messageThread("m10", "simon", "@claude say hello", [reply("m11", member, "Hello."), reply("m12", "simon", "again")]))
    await runner.receive(replied("m10", "m12"))
    expect(started[0]?.spec.resumeId).toBeNull()
    expect(started[0]?.spec.prompt).toContain("claude: Hello.")
  })
})

describe("memory in prompts (10a, 10b)", () => {
  test("a new conversation starts with the channel's memory and the agent's notes, dead ends and decisions first; a resumed one does not repeat them", async () => {
    const { runner, board, started } = setup()
    board.memory.channel.push(memoryItem(1, "Release is Friday"), memoryItem(2, "Primary keys are uuid", { kind: "decision", sourceThread: "m12" }), memoryItem(3, "Do not use the v1 importer", { kind: "dead-end" }))
    board.memory.notes.push(memoryItem(4, "Simon wants short answers", { scope: "agent", owner: member, kind: "preference" }))
    board.threads.set("m10", messageThread("m10", "simon", "@claude say hello"))
    await runner.receive(mention("m10"))
    const prompt = started[0]?.spec.prompt ?? ""
    expect(prompt).toContain("Primary keys are uuid (from m12)")
    expect(prompt).toContain("Simon wants short answers")
    expect(prompt.indexOf("Do not use the v1 importer")).toBeLessThan(prompt.indexOf("Primary keys are uuid"))
    expect(prompt.indexOf("Primary keys are uuid")).toBeLessThan(prompt.indexOf("Release is Friday"))
    expect(prompt.indexOf("What #general remembers")).toBeLessThan(prompt.indexOf("A conversation in #general"))
  })

  test("a work prompt carries the memory too, and a board that cannot answer does not stop the run", async () => {
    const { runner, board, started } = setup()
    board.memory.channel.push(memoryItem(1, "Tests run with bun test"))
    board.tasks.set(830, task({ id: 830, claimEpoch: 4 }))
    await runner.receive(event({ type: "task.created", actor: "simon", taskId: 830, threadId: "830", data: { state: "ready" } }))
    expect(started[0]?.spec.prompt).toContain("Tests run with bun test")
    const broken = setup()
    broken.board.port.memory = async () => {
      throw new Error("down")
    }
    broken.board.threads.set("m10", messageThread("m10", "simon", "@claude hi"))
    await broken.runner.receive(mention("m10"))
    expect(broken.started).toHaveLength(1)
    expect(broken.logs.some((l) => l.includes("could not read memory"))).toBe(true)
  })

  test("the block stays inside its cap and says how many items it left out", () => {
    const items = Array.from({ length: 40 }, (_, i) => memoryItem(i + 1, `Fact number ${i + 1} ${"x".repeat(80)}`, { updatedAt: `2026-11-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z` }))
    const block = memoryBlock("general", { notes: [], channel: items }, { notes: 1000, channel: 1000 })
    expect(block.length).toBeLessThan(1000 + 300)
    expect(block).toMatch(/\(\d+ more; flockr memory list --channel general\)/)
    expect(memoryBlock("general", { notes: [], channel: [] })).toBe("")
  })
})
