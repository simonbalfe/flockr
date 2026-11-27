import { describe, expect, it, test } from "bun:test"
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { fauxAssistantMessage, fauxText, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai"
import { registerStorageConformance } from "@earendil-works/pi-durable/testing"
import { builtInModel } from "../src/config"
import { AgentHome, defaultAgentSettings, requestIdFor } from "../src/harness/pi/agent"
import { insideFolder } from "../src/harness/pi/folder"
import { offeredFileTools, runIdFor, toolNames } from "../src/harness/pi/tools"
import { openAgentStorage } from "../src/harness/pi/sqlite"
import { harnesses } from "../src/harness/registry"
import type { SessionSaver } from "../src/harness/types"
import { ruleFor } from "../src/permissions"
import { failedText } from "../src/prompt"
import { FakePiBoard, fauxSource, member, person, piHarness, spec, tempDir, testModel } from "./pi-fakes"

const say = (text: string) => fauxAssistantMessage(fauxText(text))
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })

const transcript = (context: TranscriptContext) => JSON.stringify(context.messages)

const lastToolResult = (context: TranscriptContext) => {
  const result = context.messages.findLast((m) => m.role === "toolResult")
  if (!result || result.role !== "toolResult") return { error: true, text: "no tool result" }
  return { error: result.isError, text: result.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("") }
}

const newBoard = () => new FakePiBoard({ thread: "m1", who: person, text: "@scout hi" })

async function homeOn(options: { board: FakePiBoard; file: string; source: ReturnType<typeof fauxSource>["source"] }) {
  return AgentHome.open({
    file: options.file,
    member,
    board: options.board,
    models: options.source.models,
    log: () => undefined,
    failedText,
    settings: { ...defaultAgentSettings, retry: { enabled: false } },
  })
}

const turnSettings = (source: ReturnType<typeof fauxSource>["source"], folder: string | null = null) => ({
  model: source.ref("faux"),
  instructions: "be brief",
  folder,
  fileTools: offeredFileTools(ruleFor("edit-free-commands-ask")),
  maxTurns: 10,
})

describe("the built-in harness", () => {
  test("is registered as pi-durable with its label and declares resume and streaming", () => {
    const found = harnesses.find((h) => h.name === "pi-durable")
    expect(found?.label).toBe("Built-in agent")
    expect(found?.capabilities).toEqual({ resume: true, streaming: true })
  })

  test("is unavailable with the reason no model key when no key is configured, and never crashes", () => {
    const { source } = fauxSource([])
    const { harness } = piHarness({ board: newBoard(), source, dir: tempDir(), model: testModel({ key: null }) })
    expect(harness.probe({ PATH: "" })).toEqual({ kind: "missing", reason: "no model key" })
    const ready = piHarness({ board: newBoard(), source, dir: tempDir() }).harness
    expect(ready.probe({ PATH: "" })).toEqual({ kind: "available" })
  })

  test("reads the key only from the environment variable the runner config names", () => {
    const dir = tempDir()
    const file = path.join(dir, "runner.json")
    writeFileSync(file, JSON.stringify({ models: { keyEnv: "FLOCKR_TEST_MODEL_KEY", baseUrl: "http://127.0.0.1:9/v1", defaultModel: "some/model" } }))
    delete process.env.FLOCKR_TEST_MODEL_KEY
    expect(builtInModel(file)).toMatchObject({ key: null, baseUrl: "http://127.0.0.1:9/v1", defaultModel: "some/model", problem: null })
    process.env.FLOCKR_TEST_MODEL_KEY = "invented-test-value"
    expect(builtInModel(file).key).toBe("invented-test-value")
    delete process.env.FLOCKR_TEST_MODEL_KEY
    writeFileSync(file, JSON.stringify({ models: { baseUrl: "not a url" } }))
    expect(builtInModel(file).problem).toContain("baseUrl")
  })

  test("a mention produces exactly one reply, posted as the member", async () => {
    const board = newBoard()
    const { source, faux } = fauxSource([(context) => say(transcript(context).includes("@scout hi") ? "Hello dana" : "lost the message")])
    const { harness } = piHarness({ board, source, dir: tempDir() })
    const session = harness.start(spec())
    expect(await session.exit).toEqual({ kind: "finished", text: "" })
    expect(board.replies).toEqual([{ thread: "m1", text: "Hello dana" }])
    expect(faux.state.callCount).toBe(1)
    await (await harness.home(member))?.close()
  })

  test("a follow-up sent into a running session is answered in the same conversation", async () => {
    const board = newBoard()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { source } = fauxSource([
      async () => {
        await gate
        return say("first answer")
      },
      (context) => say(transcript(context).includes("first answer") ? "second answer, with memory" : "no memory"),
    ])
    const { harness } = piHarness({ board, source, dir: tempDir() })
    const session = harness.start(spec())
    board.say("m1", person, "and another thing")
    expect(session.send("dana replied in thread m1:\n\nand another thing")).toBe(true)
    release()
    expect(await session.exit).toEqual({ kind: "finished", text: "" })
    expect(board.replies.map((r) => r.text)).toEqual(["first answer", "second answer, with memory"])
    expect(session.send("too late")).toBe(false)
    await (await harness.home(member))?.close()
  })

  test("memory persists across restarts: a second turn sees the first", async () => {
    const board = newBoard()
    const dir = tempDir()
    const first = fauxSource([say("Noted: the code word is heron.")])
    const one = piHarness({ board, source: first.source, dir })
    await one.harness.start(spec({ prompt: "dana: remember the code word heron" })).exit
    await (await one.harness.home(member))?.close()

    board.say("m1", person, "what was the code word?")
    const second = fauxSource([(context) => say(transcript(context).includes("heron") ? "heron" : "I do not remember")])
    const two = piHarness({ board, source: second.source, dir })
    await two.harness.start(spec({ prompt: "dana replied in thread m1:\n\nwhat was the code word?" })).exit
    expect(board.replies.map((r) => r.text)).toEqual(["Noted: the code word is heron.", "heron"])
    await (await two.harness.home(member))?.close()
  })

  test("a crash right after posting and a restart do not post the reply twice", async () => {
    const board = newBoard()
    const file = path.join(tempDir(), "agent.sqlite")
    const first = fauxSource([say("Here is the answer.")])
    board.crashAfterReply = true
    const home = await homeOn({ board, file, source: first.source })
    await expect(home.turn({ thread: "m1", prompt: "dana: @scout hi", settings: turnSettings(first.source) })).rejects.toThrow("died")
    await home.close()
    board.crashAfterReply = false

    const second = fauxSource([say("A different answer that must not be posted.")])
    const restarted = await homeOn({ board, file, source: second.source })
    expect(await restarted.recover()).toBe(1)
    expect(board.replies.map((r) => r.text)).toEqual(["Here is the answer."])
    expect(second.faux.state.callCount).toBe(0)
    expect(await restarted.recover()).toBe(0)
    await restarted.close()
  })

  test("a crash during the model call resumes after a restart and posts once", async () => {
    const board = newBoard()
    const file = path.join(tempDir(), "agent.sqlite")
    const hung = fauxSource([
      (_context, options) =>
        new Promise((resolve) => options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "closed" })))),
    ])
    const home = await homeOn({ board, file, source: hung.source })
    const pending = home.turn({ thread: "m1", prompt: "dana: @scout hi", settings: turnSettings(hung.source) }).catch((error: unknown) => error)
    while (hung.faux.state.callCount === 0) await Bun.sleep(5)
    await home.close()
    await pending
    expect(board.replies).toEqual([])

    const after = fauxSource([say("Answered after the restart.")])
    const restarted = await homeOn({ board, file, source: after.source })
    await restarted.recover()
    expect(board.replies.map((r) => r.text)).toEqual(["Answered after the restart."])
    await restarted.recover()
    expect(board.replies).toHaveLength(1)
    await restarted.close()
  })

  test("the same board message is one request: a retried turn changes nothing twice", async () => {
    const board = newBoard()
    const { source, faux } = fauxSource([say("Only once."), say("A second answer must not happen.")])
    const home = await homeOn({ board, file: path.join(tempDir(), "agent.sqlite"), source })
    const prompt = "dana: @scout hi"
    await home.turn({ thread: "m1", prompt, settings: turnSettings(source) })
    await home.turn({ thread: "m1", prompt, settings: turnSettings(source) })
    expect(board.replies.map((r) => r.text)).toEqual(["Only once."])
    expect(faux.state.callCount).toBe(1)
    expect(requestIdFor({ thread: "m1", messageId: "m1", prompt })).toBe("msg-m1")
    expect(requestIdFor({ thread: "m1", messageId: null, prompt })).toBe(requestIdFor({ thread: "m1", messageId: null, prompt }))
    await home.close()
  })

  test("a stop request aborts the run, posts nothing and reports stopped", async () => {
    const board = newBoard()
    const { source } = fauxSource([
      (_context, options) =>
        new Promise((resolve) => options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "stopped" })))),
    ])
    const { harness } = piHarness({ board, source, dir: tempDir() })
    const session = harness.start(spec())
    while (!(await harness.home(member))) await Bun.sleep(5)
    await Bun.sleep(20)
    session.stop()
    expect(await session.exit).toEqual({ kind: "stopped" })
    expect(board.replies).toEqual([])
    await (await harness.home(member))?.close()
  })

  test("a failed run reports failed so the runner posts one short reply, and the state is kept", async () => {
    const board = newBoard()
    const { source } = fauxSource([fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider exploded" })])
    const { harness } = piHarness({ board, source, dir: tempDir() })
    const exit = await harness.start(spec()).exit
    expect(exit.kind).toBe("failed")
    expect(board.replies).toEqual([])
    await (await harness.home(member))?.close()
  })

  test("an agent with no model reports why instead of calling anything", async () => {
    const board = newBoard()
    const { source, faux } = fauxSource([say("never")])
    const { harness } = piHarness({ board, source, dir: tempDir(), model: testModel({ defaultModel: null }) })
    expect(await harness.start(spec()).exit).toEqual({ kind: "failed", error: "no model is set for this agent" })
    expect(faux.state.callCount).toBe(0)
  })
})

describe("its tools", () => {
  test("no shell tool exists; file tools only with a folder, and edits only when the permissions allow them", async () => {
    const board = newBoard()
    const folder = tempDir()
    const { source } = fauxSource([say("ok"), say("ok"), say("ok")])
    const home = await homeOn({ board, file: path.join(tempDir(), "agent.sqlite"), source })
    await home.turn({ thread: "m1", prompt: "dana: @scout hi", settings: turnSettings(source, folder) })
    const withFolder = await home.offeredTools("m1")
    expect(withFolder.sort()).toEqual([toolNames.ask, toolNames.createTask, toolNames.readThread, toolNames.reply, "edit", "read", "write"].sort())
    expect(withFolder.some((name) => /bash|shell|exec|powershell|command/i.test(name))).toBe(false)
    board.say("m1", person, "again")
    await home.turn({ thread: "m1", prompt: "dana replied in thread m1:\n\nagain", settings: { ...turnSettings(source, folder), fileTools: offeredFileTools(ruleFor("read-only")) } })
    expect((await home.offeredTools("m1")).filter((n) => ["read", "write", "edit"].includes(n))).toEqual(["read"])
    board.say("m1", person, "once more")
    await home.turn({ thread: "m1", prompt: "dana replied in thread m1:\n\nonce more", settings: turnSettings(source, null) })
    expect((await home.offeredTools("m1")).sort()).toEqual([toolNames.ask, toolNames.createTask, toolNames.readThread, toolNames.reply].sort())
    await home.close()
  })

  test("the folder sandbox refuses ../ escapes, absolute paths outside, home paths and symlinks out", () => {
    const folder = tempDir()
    const outside = tempDir()
    mkdirSync(path.join(folder, "src"))
    symlinkSync(outside, path.join(folder, "escape"))
    expect(insideFolder(folder, "src/new.ts").kind).toBe("inside")
    expect(insideFolder(folder, path.join(folder, "src", "a.ts")).kind).toBe("inside")
    expect(insideFolder(folder, "../secret.txt").kind).toBe("refused")
    expect(insideFolder(folder, "src/../../secret.txt").kind).toBe("refused")
    expect(insideFolder(folder, "/etc/passwd").kind).toBe("refused")
    expect(insideFolder(folder, path.join(outside, "x")).kind).toBe("refused")
    expect(insideFolder(folder, "~/.ssh/id_ed25519").kind).toBe("refused")
    expect(insideFolder(folder, "escape/x").kind).toBe("refused")
    expect(insideFolder(folder, "").kind).toBe("refused")
  })

  test("file tools work inside the folder and refuse a path outside it, end to end", async () => {
    const board = newBoard()
    const folder = tempDir()
    const outside = tempDir()
    writeFileSync(path.join(outside, "secret.txt"), "do not read")
    const seen: { error: boolean; text: string }[] = []
    const { source } = fauxSource([
      call("write", { path: "notes/plan.md", content: "step one" }),
      (context) => {
        seen.push(lastToolResult(context))
        return call("read", { path: path.join(outside, "secret.txt") })
      },
      (context) => {
        seen.push(lastToolResult(context))
        return call("read", { path: "../secret.txt" })
      },
      (context) => {
        seen.push(lastToolResult(context))
        return say("done")
      },
    ])
    const home = await homeOn({ board, file: path.join(tempDir(), "agent.sqlite"), source })
    await home.turn({ thread: "m1", prompt: "dana: @scout write a plan", settings: turnSettings(source, folder) })
    expect(readFileSync(path.join(folder, "notes/plan.md"), "utf8")).toBe("step one")
    expect(seen[0]?.error).toBe(false)
    expect(seen[1]).toMatchObject({ error: true })
    expect(seen[1]?.text).toContain("outside the agent's folder")
    expect(seen[1]?.text).not.toContain("do not read")
    expect(seen[2]).toMatchObject({ error: true })
    await home.close()
  })

  test("the question tool posts a card only a person can answer; the agent has no way to answer it", async () => {
    const board = newBoard()
    const results: { error: boolean; text: string }[] = []
    const { source } = fauxSource([
      call(toolNames.ask, { question: "Deploy now?", options: ["Deploy", "Wait"] }),
      (context) => {
        results.push(lastToolResult(context))
        return call("answer_in_thread", { option: "Deploy" })
      },
      (context) => {
        results.push(lastToolResult(context))
        return say("Asked dana.")
      },
    ])
    const entry = board.startActivity("m1", runIdFor("m1"))
    const home = await homeOn({ board, file: path.join(tempDir(), "agent.sqlite"), source })
    await home.turn({ thread: "m1", prompt: "dana: @scout should we deploy?", settings: turnSettings(source) })
    expect(board.asked).toEqual([{ thread: "m1", text: "Deploy now?", options: ["Deploy", "Wait"] }])
    expect(results[0]?.text).toContain("Only a person can answer")
    expect(results[1]?.error).toBe(true)
    const thread = await board.thread("m1")
    expect(thread.entries.flatMap((e) => (e.kind === "question" ? [e.answer] : []))).toEqual([null])
    expect((await home.offeredTools("m1")).some((n) => /answer/.test(n))).toBe(false)
    expect(board.updates.filter((u) => u.entryId === entry).flatMap((u) => u.updates.map((x) => x.type))).toEqual(["part.set", "part.finished"])
    await home.close()
  })

  test("a task is made only when a person in the thread asked for one", async () => {
    const board = newBoard()
    board.say("m1", "helper", "make a task for the login bug")
    const results: { error: boolean; text: string }[] = []
    const { source } = fauxSource([
      call(toolNames.createTask, { title: "Fix login", quote: "make a task for the login bug" }),
      (context) => {
        results.push(lastToolResult(context))
        return call(toolNames.createTask, { title: "Fix login", quote: "I would like a task" })
      },
      (context) => {
        results.push(lastToolResult(context))
        return say("No task: nobody asked.")
      },
    ])
    const home = await homeOn({ board, file: path.join(tempDir(), "agent.sqlite"), source })
    await home.turn({ thread: "m1", prompt: "helper: make a task for the login bug", settings: turnSettings(source) })
    expect(board.created).toEqual([])
    expect(results.every((r) => r.error)).toBe(true)

    board.say("m1", person, "please make a task for the login bug")
    const asked = fauxSource([call(toolNames.createTask, { title: "Fix login", quote: "please make a task for the login bug" }), say("Made it.")])
    const again = await homeOn({ board, file: path.join(tempDir(), "agent.sqlite"), source: asked.source })
    await again.turn({ thread: "m1", prompt: "dana replied in thread m1:\n\nplease make a task for the login bug", settings: turnSettings(asked.source) })
    expect(board.created.map((t) => t.title)).toEqual(["Fix login"])
    await home.close()
    await again.close()
  })

  test("a progress reply is posted once even when the model repeats it", async () => {
    const board = newBoard()
    const { source } = fauxSource([call(toolNames.reply, { text: "Looking now." }), call(toolNames.reply, { text: "Looking now." }), say("Found it.")])
    const home = await homeOn({ board, file: path.join(tempDir(), "agent.sqlite"), source })
    await home.turn({ thread: "m1", prompt: "dana: @scout hi", settings: turnSettings(source) })
    expect(board.replies.map((r) => r.text)).toEqual(["Looking now.", "Found it."])
    await home.close()
  })
})

registerStorageConformance({ describe, expect, it }, "the runner's Bun SQLite storage", async (use) => {
  const storage = await openAgentStorage(path.join(tempDir(), "agent.sqlite"))
  try {
    await use(storage)
  } finally {
    await storage.close(BACKGROUND_CONTEXT)
  }
})

describe("saved sessions (PL5)", () => {
  function fakeSaver() {
    const chunks: Uint8Array[] = []
    const places: string[] = []
    const saver: SessionSaver = {
      restore: async (place) => {
        places.push(`restore ${place.session}`)
        return [...chunks]
      },
      save: async (place, chunk) => {
        places.push(`save ${place.session}`)
        chunks.push(chunk.data)
        return true
      },
      cursor: () => null,
      mark: () => undefined,
      latest: async () => null,
    }
    return { saver, chunks, places }
  }

  test("a wiped agent rebuilds from its chunks in turn order and remembers the earlier turns", async () => {
    const board = newBoard()
    const saved = fakeSaver()
    const first = fauxSource([say("Noted: the code word is heron."), say("Noted: the colour is teal.")])
    const one = piHarness({ board, source: first.source, dir: tempDir() })
    await one.harness.start(spec({ prompt: "dana: remember the code word heron", saver: saved.saver })).exit
    board.say("m1", person, "and the colour teal")
    await one.harness.start(spec({ prompt: "dana: and the colour teal", saver: saved.saver })).exit
    await (await one.harness.home(member))?.close()
    expect(saved.chunks.length).toBeGreaterThanOrEqual(2)

    board.say("m1", person, "what were they?")
    const second = fauxSource([(context) => say(transcript(context).includes("heron") && transcript(context).includes("teal") ? "heron and teal" : "I do not remember")])
    const two = piHarness({ board, source: second.source, dir: tempDir() })
    await two.harness.start(spec({ prompt: "dana replied in thread m1:\n\nwhat were they?", saver: saved.saver })).exit
    expect(board.replies.at(-1)?.text).toBe("heron and teal")
    expect(saved.places.filter((p) => p.startsWith("restore"))).toEqual(["restore agent", "restore agent"])
    await (await two.harness.home(member))?.close()
  })
})
