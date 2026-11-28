import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { fauxAssistantMessage, fauxText, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai"
import { sandboxFor } from "@flockr/sandbox"
import type { RunOptions, RunResult } from "@flockr/sandbox/sandbox"
import { AgentHome, defaultAgentSettings } from "../src/harness/pi/agent"
import { boxCommands, boxExecutionEnv, type BoxFiles } from "../src/harness/pi/box-env"
import { openAgentStorage } from "../src/harness/pi/sqlite"
import { boxBash, carryOn, offeredBoxTools, type ToolPlace } from "../src/harness/pi/tools"
import { ruleFor } from "../src/permissions"
import { failedText } from "../src/prompt"
import { FakePiBoard, fauxSource, member, person, tempDir } from "./pi-fakes"

const repo = path.resolve(import.meta.dir, "../../..")
const image = "flockr-box:dev"
const dockerUp = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0
const context = BACKGROUND_CONTEXT

const say = (text: string) => fauxAssistantMessage(fauxText(text))
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })
const lastToolResult = (transcript: TranscriptContext) => {
  const result = transcript.messages.findLast((m) => m.role === "toolResult")
  if (!result || result.role !== "toolResult") return { error: true, text: "no tool result" }
  return { error: result.isError, text: result.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("") }
}
const userTexts = (transcript: TranscriptContext) => transcript.messages.flatMap((m) => (m.role === "user" ? [typeof m.content === "string" ? m.content : m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("")] : []))

const newBoard = () => new FakePiBoard({ thread: "m1", who: person, text: "@scout fix the test" })
const boxRule = ruleFor("edit-free-commands-ask")

function settings(source: ReturnType<typeof fauxSource>["source"]) {
  return { model: source.ref("faux"), instructions: "be brief", folder: "/workspace", channel: "general", fileTools: offeredBoxTools(boxRule), maxTurns: 10 }
}

async function homeIn(options: { board: FakePiBoard; file: string; source: ReturnType<typeof fauxSource>["source"]; place: ToolPlace }) {
  return AgentHome.open({
    storage: await openAgentStorage(options.file),
    member,
    board: () => options.board,
    workspace: options.place,
    models: options.source.models,
    log: () => undefined,
    failedText,
    settings: { ...defaultAgentSettings, retry: { enabled: false } },
  })
}

describe("box tools, without a box", () => {
  test("bash gets the default timeout when the model gives none, and never more than the most", () => {
    expect(boxBash.replay).toBe("unsafe")
    expect(boxBash.prepareArguments?.({ command: "npm test" })).toEqual({ command: "npm test", timeout: boxCommands.defaultSeconds })
    expect(boxBash.prepareArguments?.({ command: "npm test", timeout: 30 })).toEqual({ command: "npm test", timeout: 30 })
    expect(boxBash.prepareArguments?.({ command: "npm test", timeout: 86_400 })).toEqual({ command: "npm test", timeout: boxCommands.maxSeconds })
  })

  test("every command the environment runs has a timeout, the default when none is given", async () => {
    const seen: RunOptions[] = []
    const box: BoxFiles = {
      run: async (_id, _command, options = {}): Promise<RunResult> => {
        seen.push(options)
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, truncated: false }
      },
      readFile: async () => new Uint8Array(),
      writeFile: async () => undefined,
    }
    const env = boxExecutionEnv({ box, id: "box-1" })
    await env.exec("make", undefined, context)
    await env.exec(["ls"], { timeout: 7 }, context)
    await env.exec("sleep 99999", { timeout: 99_999 }, context)
    await env.fileInfo("a.txt", context)
    expect(seen.map((o) => o.timeoutSeconds)).toEqual([boxCommands.defaultSeconds, 7, boxCommands.maxSeconds, boxCommands.fileSeconds])
  })

  test("the box offers bash unless commands or edits are denied", () => {
    expect(offeredBoxTools(ruleFor("edit-free-commands-ask")).map((t) => t.name)).toEqual(["read", "write", "edit", "bash"])
    expect(offeredBoxTools(ruleFor("read-only")).map((t) => t.name)).toEqual(["read"])
  })
})

describe("carrying on at the output limit", () => {
  const cut = (text: string) => fauxAssistantMessage(fauxText(text), { stopReason: "length" })
  const place: ToolPlace = { kind: "box", cwd: "/workspace", env: async () => boxExecutionEnv({ box: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, truncated: false }), readFile: async () => null, writeFile: async () => undefined }, id: "unused" }) }

  test("a reply cut off at the output limit carries on, and the finished reply is posted", async () => {
    const board = newBoard()
    const prompts: string[][] = []
    const { source, faux } = fauxSource([cut("Step one is to"), (transcript) => {
      prompts.push(userTexts(transcript))
      return say("Done: the test passes.")
    }])
    const home = await homeIn({ board, file: path.join(tempDir(), "agent.sqlite"), source, place })
    const outcome = await home.turn({ thread: "m1", prompt: "dana: @scout fix the test", settings: settings(source) })
    expect(outcome).toEqual({ kind: "answered", text: "Done: the test passes." })
    expect(faux.state.callCount).toBe(2)
    expect(prompts[0]?.at(-1)).toBe(carryOn.prompt)
    expect(board.replies.map((r) => r.text)).toEqual(["Done: the test passes."])
    await home.close()
  })

  test("it carries on at most three times in a row", async () => {
    const board = newBoard()
    const { source, faux } = fauxSource([cut("a"), cut("b"), cut("c"), cut("d"), say("never reached")])
    const home = await homeIn({ board, file: path.join(tempDir(), "agent.sqlite"), source, place })
    const outcome = await home.turn({ thread: "m1", prompt: "dana: @scout fix the test", settings: settings(source) })
    expect(faux.state.callCount).toBe(carryOn.limit + 1)
    expect(outcome).toEqual({ kind: "answered", text: "d" })
    await home.close()
  })
})

describe.skipIf(!dockerUp)("box tools in a real box (PL6)", () => {
  const sandbox = sandboxFor("docker")
  let boxId = ""
  const place = (): ToolPlace => ({ kind: "box", cwd: "/workspace", env: async () => boxExecutionEnv({ box: sandbox, id: boxId }) })
  const read = async (file: string) => new TextDecoder().decode((await sandbox.readFile(boxId, file)) ?? new Uint8Array())

  beforeAll(async () => {
    const built = spawnSync("docker", ["build", "-q", "-t", image, path.join(repo, "packages/sandbox/box")], { stdio: "ignore" })
    if (built.status !== 0) throw new Error("could not build the box image")
    boxId = (await sandbox.start({ image, timeLimitSeconds: 600, diskMb: 256, labels: { task: "806" } })).id
  }, 180_000)

  afterAll(async () => {
    if (boxId) await sandbox.stop(boxId)
  })

  test("read, write, edit and bash work in the box as a normal user", async () => {
    const board = newBoard()
    const results: { error: boolean; text: string }[] = []
    const after = (next: ReturnType<typeof call>) => (transcript: TranscriptContext) => {
      results.push(lastToolResult(transcript))
      return next
    }
    const { source } = fauxSource([
      call("write", { path: "repo/sum.sh", content: "echo $((1 + 1))\n" }),
      after(call("edit", { path: "repo/sum.sh", edits: [{ oldText: "1 + 1", newText: "2 + 3" }] })),
      after(call("read", { path: "/workspace/repo/sum.sh" })),
      after(call("bash", { command: "cd repo && bash sum.sh && id -u && touch /etc/flockr" })),
      after(call("bash", { command: "rg --version | head -1 && git --version" })),
      after(say("done")),
    ])
    const home = await homeIn({ board, file: path.join(tempDir(), "agent.sqlite"), source, place: place() })
    await home.turn({ thread: "m1", prompt: "dana: @scout fix the test", settings: settings(source) })
    expect(await read("repo/sum.sh")).toBe("echo $((2 + 3))\n")
    expect(results[0]?.error).toBe(false)
    expect(results[1]?.error).toBe(false)
    expect(results[2]?.text).toContain("2 + 3")
    expect(results[3]).toMatchObject({ error: true })
    expect(results[3]?.text).toContain("5\n1000")
    expect(results[3]?.text).toMatch(/Permission denied|Read-only file system/)
    expect(results[4]).toMatchObject({ error: false })
    expect(results[4]?.text).toContain("ripgrep")
    await home.close()
  })

  test("a shell command cut off by a crash is not run again after the restart", async () => {
    const board = newBoard()
    const file = path.join(tempDir(), "agent.sqlite")
    const command = "echo started >> /workspace/runs.log && sleep 3"
    const first = fauxSource([call("bash", { command }), say("never")])
    const home = await homeIn({ board, file, source: first.source, place: place() })
    const pending = home.turn({ thread: "m1", prompt: "dana: @scout fix the test", settings: settings(first.source) }).catch((error: unknown) => error)
    while (!(await read("runs.log")).includes("started")) await Bun.sleep(20)
    await home.close()
    await pending

    const seen: { error: boolean; text: string }[] = []
    const second = fauxSource([(transcript) => {
      seen.push(lastToolResult(transcript))
      return say("I will check before running it again.")
    }])
    const restarted = await homeIn({ board, file, source: second.source, place: place() })
    await restarted.recover()
    await Bun.sleep(3500)
    expect(await read("runs.log")).toBe("started\n")
    expect(seen[0]?.error).toBe(true)
    expect(board.replies.map((r) => r.text)).toEqual(["I will check before running it again."])
    await restarted.close()
  }, 30_000)
})
