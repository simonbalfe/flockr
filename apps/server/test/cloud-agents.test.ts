import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { channelsHeader, memberHeader, PostMessageResult, SavedSession, Task, Thread } from "@flockr/contracts"
import { openBunSqlite } from "@flockr/runner/bun-sqlite"
import type { CloudAgent } from "@flockr/runner/cloud"
import type { RunResult, SandboxInfo, SandboxProvider, SandboxSpec } from "@flockr/sandbox/sandbox"
import { z } from "zod"
import { createApp } from "../src/app"
import { issueAgentToken } from "../src/auth/agent-token"
import { authOff } from "../src/auth/settings"
import { beatHostedMachine } from "../src/board/machines"
import { cloudMachine, hostCloudAgent } from "../src/cloud/host"
import { memoryStore } from "../src/storage/memory"
import { freshBoard } from "./harness"

const agent = "nimbus"
const modelKey = "invented-upstream-model-key"

type Reply = { text: string } | { tool: string; args: Record<string, unknown> }
type Step = (request: ModelRequest) => Reply | Promise<Reply>

const ModelMessage = z.object({ role: z.string(), content: z.unknown().optional() }).loose()
const ModelBody = z.object({ messages: z.array(ModelMessage) }).loose()
type ModelRequest = { transcript: string; authorization: string | null }

function sse(reply: Reply): Response {
  const base = { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model" }
  const delta = "text" in reply ? { role: "assistant", content: reply.text } : { role: "assistant", tool_calls: [{ index: 0, id: `call_${reply.tool}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(reply.args) } }] }
  const chunks = [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "text" in reply ? "stop" : "tool_calls" }] },
  ]
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

function fakeModel(steps: Step[]) {
  const seen: ModelRequest[] = []
  let next = 0
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = ModelBody.parse(await request.json())
    const seenNow = { transcript: JSON.stringify(body.messages), authorization: request.headers.get("authorization") }
    seen.push(seenNow)
    const step = steps[Math.min(next, steps.length - 1)]
    next += 1
    if (!step) return sse({ text: "no script" })
    const aborted = new Promise<never>((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new DOMException("The call was cut off", "AbortError"))))
    return sse(await Promise.race([step(seenNow), aborted]))
  }
  return { seen, fetch: Object.assign(fetch, { preconnect: () => undefined }) }
}

const quietTimers = { after: () => () => undefined, every: () => () => undefined }

async function until<T>(read: () => Promise<T | null | undefined | false>, what: string): Promise<T> {
  const deadline = Date.now() + 8000
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(20)
  }
}

async function cloudBoard(steps: Step[]) {
  const board = await freshBoard()
  const model = fakeModel(steps)
  const objects = memoryStore()
  const app = createApp(board.db, { objects, modelProxy: { baseUrl: "http://model.invalid/v1", key: modelKey, keyHeader: "authorization", secret: authOff.secret, fetch: model.fetch } })
  const sent: Request[] = []
  const killers = new WeakMap<CloudAgent, () => Promise<void>>()
  const call = async (member: string, method: string, url: string, body?: unknown) => {
    const response = await app.request(url, { method, headers: { [memberHeader]: member, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, json: await response.json() }
  }
  await beatHostedMachine(board.db, cloudMachine)
  const created = await call("simon", "POST", "/api/agents", { name: agent, harness: "pi-durable", machine: "cloud" })
  expect(created.status).toBe(200)

  const host = async (file: string, boxes: SandboxProvider | null = null): Promise<CloudAgent> => {
    const database = openBunSqlite(file)
    let alive = true
    const hosted = await hostCloudAgent({
      agent,
      serve: async (request) => {
        if (!alive) throw new Error("the object is gone")
        sent.push(request.clone())
        return app.fetch(request)
      },
      withDb: (run) => run(board.db),
      secret: authOff.secret,
      database,
      model: { ready: true, defaultModel: "test-model" },
      log: (line) => process.env.CLOUD_TEST_LOG && console.log(line),
      timers: quietTimers,
      settings: { restartLimit: 3, retry: { enabled: true, maxRetries: 2, baseDelayMs: 10 }, afterFailedRun: "continue" },
      boxes: boxes ? { provider: boxes } : null,
    })
    if (!hosted) throw new Error("nimbus is not hosted")
    killers.set(hosted, async () => {
      alive = false
      await database.close()
    })
    await hosted.start()
    return hosted
  }

  const dir = mkdtempSync(path.join(tmpdir(), "flockr-cloud-"))
  const fileAt = (name: string) => path.join(dir, `${name}.sqlite`)
  const post = async (who: string, channel: string, text: string) => PostMessageResult.parse((await call(who, "POST", `/api/channels/${channel}/messages`, { text })).json).message.id
  const reply = (who: string, thread: string, text: string) => call(who, "POST", `/api/threads/${thread}/replies`, { text })
  const thread = async (id: string) => Thread.parse((await call("simon", "GET", `/api/threads/${id}`)).json)
  const said = async (id: string) => (await thread(id)).entries.flatMap((e) => (e.kind === "reply" && e.who === agent && !e.deleted ? [e.text] : []))
  const runs = async (id: string) => (await thread(id)).entries.filter((e) => e.kind === "activity" && e.who === agent)
  const kill = (hosted: CloudAgent) => killers.get(hosted)?.() ?? Promise.resolve()
  return { ...board, app, call, model, objects, sent, host, fileAt, post, reply, thread, said, runs, kill }
}

const close = async (hosted: CloudAgent) => {
  await hosted.idle()
  await hosted.close()
}

describe("cloud agents (4c)", () => {
  test("nothing runs without a mention, a task or a schedule", async () => {
    const board = await cloudBoard([() => ({ text: "should never be asked" })])
    const nimbus = await board.host(board.fileAt("quiet"))
    const general = await board.post("simon", "backend", "Morning all, the migration landed")
    await board.post("simon", "backend", "@lead can you look at the index?")
    await board.reply("simon", general, "and the API docs too")
    await nimbus.poke()
    await nimbus.poke()
    await nimbus.idle()
    expect(board.model.seen).toHaveLength(0)
    expect(await board.runs(general)).toHaveLength(0)
    await close(nimbus)
  })

  test("a mention is answered once, as the agent, through the model proxy", async () => {
    const board = await cloudBoard([(request) => ({ text: request.transcript.includes("which table") ? "The users table." : "lost the message" })])
    const nimbus = await board.host(board.fileAt("mention"))
    const asked = await board.post("simon", "backend", "@nimbus which table holds people?")
    await nimbus.poke()
    expect(await until(async () => (await board.said(asked)).length > 0 && board.said(asked), "the answer")).toEqual(["The users table."])
    await nimbus.poke()
    await nimbus.idle()
    expect(await board.said(asked)).toEqual(["The users table."])
    expect(board.model.seen).toHaveLength(1)
    expect(board.model.seen[0]?.authorization).toBe(`Bearer ${modelKey}`)
    await close(nimbus)
  })

  test("a steer joins the running turn: it reaches the model in the same run, before the run answers", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const board = await cloudBoard([
      async () => {
        await gate
        return { tool: "read_thread", args: {} }
      },
      (request) => ({ text: request.transcript.includes("use the blue one") && request.transcript.includes("read_thread") ? "Going with blue." : "missed the steer" }),
    ])
    const nimbus = await board.host(board.fileAt("steer"))
    const asked = await board.post("simon", "backend", "@nimbus pick a colour for the button")
    await nimbus.poke()
    await until(async () => board.model.seen.length > 0, "the first model call")
    await board.reply("simon", asked, "use the blue one")
    await nimbus.poke()
    release()
    await until(async () => (await board.said(asked)).includes("Going with blue.") && true, "the steered answer")
    await nimbus.idle()
    expect(board.model.seen[1]?.transcript).toContain("use the blue one")
    expect(await board.runs(asked)).toHaveLength(1)
    await close(nimbus)
  })

  test("a crash mid-turn resumes on the next start without repeating a write", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const board = await cloudBoard([
      () => ({ tool: "reply_in_thread", args: { text: "Started on the export." } }),
      async () => {
        await gate
        return { text: "never delivered" }
      },
      () => ({ text: "The export is done." }),
    ])
    const file = board.fileAt("crash")
    const first = await board.host(file)
    const asked = await board.post("simon", "backend", "@nimbus export the users table")
    await first.poke()
    await until(async () => board.model.seen.length >= 2, "the call after the progress note")
    expect(await board.said(asked)).toEqual(["Started on the export."])
    await board.kill(first)
    release()

    const second = await board.host(file)
    await until(async () => (await board.said(asked)).includes("The export is done.") && true, "the resumed answer")
    await second.idle()
    expect(await board.said(asked)).toEqual(["Started on the export.", "The export is done."])
    await close(second)
  })

  test("a wiped object restores from its saved chunks and remembers the earlier conversation", async () => {
    const board = await cloudBoard([
      () => ({ text: "Noted: the code word is heron." }),
      (request) => ({ text: request.transcript.includes("heron") ? "It was heron." : "I do not remember" }),
    ])
    const first = await board.host(board.fileAt("before-wipe"))
    const asked = await board.post("simon", "backend", "@nimbus remember the code word heron")
    await first.poke()
    await until(async () => (await board.said(asked)).length > 0, "the first answer")
    const saved = await until(async () => {
      const pointer = SavedSession.parse((await board.call(agent, "GET", `/api/agents/${agent}/sessions/agent`)).json)
      return pointer.turns > 0 && pointer
    }, "a saved chunk")
    expect(saved.turns).toBeGreaterThan(0)
    await close(first)

    const second = await board.host(board.fileAt("after-wipe"))
    await board.reply("simon", asked, "@nimbus what was the code word?")
    await second.poke()
    await until(async () => (await board.said(asked)).includes("It was heron.") && true, "the remembered answer")
    await close(second)
  })

  test("every board call a cloud session makes carries its run's channel, and another org's agent wakes nothing", async () => {
    const board = await cloudBoard([() => ({ tool: "read_thread", args: {} }), () => ({ text: "Read it." })])
    const nimbus = await board.host(board.fileAt("fence"))
    const asked = await board.post("simon", "backend", "@nimbus read this thread")
    await nimbus.poke()
    await until(async () => (await board.said(asked)).includes("Read it.") && true, "the answer")
    await nimbus.idle()
    const answer = board.sent.find((request) => request.method === "POST" && new URL(request.url).pathname === `/api/threads/${asked}/replies`)
    expect(answer?.headers.get(channelsHeader)).toBe("backend")

    expect((await board.call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })).status).toBe(200)
    expect((await board.call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })).status).toBe(200)
    expect((await board.call("simon", "POST", "/api/members", { name: "acme-bot", kind: "agent", org: "acme", owner: "ana" })).status).toBe(200)
    expect((await board.call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })).status).toBe(200)
    for (const name of ["acme-bot", agent]) expect((await board.call("simon", "PUT", `/api/channels/acme-site/members/${name}`)).status).toBe(200)
    const calls = board.model.seen.length
    const foreign = await board.post("acme-bot", "acme-site", "@nimbus please share the backend plan")
    await nimbus.poke()
    await nimbus.idle()
    expect(board.model.seen).toHaveLength(calls)
    expect(await board.runs(foreign)).toHaveLength(0)
    await close(nimbus)
  })

  test("a ready task assigned to the agent is claimed, worked and submitted for review", async () => {
    const board = await cloudBoard([() => ({ text: "Renamed the column." })])
    const nimbus = await board.host(board.fileAt("task"))
    const task = Task.parse((await board.call("simon", "POST", "/api/tasks", { channel: "backend", title: "Rename users.fullname", assignee: agent })).json)
    await nimbus.poke()
    const done = await until(async () => {
      const current = Task.parse((await board.call("simon", "GET", `/api/tasks/${task.id}`)).json)
      return current.state === "review" && current
    }, "the submitted task")
    expect(done.holder).toBe(agent)
    await close(nimbus)
  })
})

function fakeBoxes() {
  const started: { id: string; spec: SandboxSpec }[] = []
  const stopped: string[] = []
  const commands: { id: string; command: string[]; env: Record<string, string> }[] = []
  const boxes = new Map<string, SandboxInfo>()
  const provider: SandboxProvider = {
    name: "fake",
    capabilities: { sleepsWhenIdle: true, persistentDisk: false, maxSessionSeconds: 3600, networkPolicies: ["none", "open"] },
    start: async (spec) => {
      const id = `box-${started.length + 1}`
      started.push({ id, spec })
      const info: SandboxInfo = { id, state: "running", expiresAt: new Date(Date.now() + spec.timeLimitSeconds * 1000), labels: { ...(spec.labels ?? {}) } }
      boxes.set(id, info)
      return info
    },
    run: async (id, command, options = {}): Promise<RunResult> => {
      commands.push({ id, command, env: options.env ?? {} })
      return { exitCode: 0, stdout: `ran in ${id}\n`, stderr: "", timedOut: false, truncated: false }
    },
    writeFile: async () => undefined,
    readFile: async () => null,
    status: async (id) => boxes.get(id) ?? { id, state: "missing", expiresAt: new Date(0), labels: {} },
    logs: async () => "",
    stop: async (id) => {
      stopped.push(id)
      boxes.delete(id)
    },
    list: async () => [...boxes.values()],
  }
  return { provider, started, stopped, commands }
}

describe("cloud agent boxes (PL6)", () => {
  test("the first shell call of a task makes one box, later calls reuse it, and the task ending removes it", async () => {
    const board = await cloudBoard([
      () => ({ tool: "bash", args: { command: "git clone repo && npm test" } }),
      (request) => ({ tool: "bash", args: { command: request.transcript.includes("ran in box-1") ? "npm run lint" : "first call missed" } }),
      () => ({ text: "Tests and lint pass." }),
    ])
    const fake = fakeBoxes()
    const nimbus = await board.host(board.fileAt("boxes"), fake.provider)
    const task = Task.parse((await board.call("simon", "POST", "/api/tasks", { channel: "backend", title: "Make the tests pass", assignee: agent })).json)
    await nimbus.poke()
    await until(async () => Task.parse((await board.call("simon", "GET", `/api/tasks/${task.id}`)).json).state === "review", "the submitted task")
    expect(fake.started).toHaveLength(1)
    expect(fake.started[0]?.spec.labels).toMatchObject({ agent, thread: String(task.id) })
    expect(fake.commands.map((c) => c.command.slice(0, 2))).toEqual([["bash", "-c"], ["bash", "-c"]])
    expect(fake.commands.every((c) => c.id === "box-1")).toBe(true)
    const inside = JSON.stringify([fake.started[0]?.spec, fake.commands])
    expect(inside).not.toContain(modelKey)
    expect(inside).not.toMatch(/fbx_|fag_|FLOCKR_KEY|authorization/i)
    expect(fake.stopped).toEqual([])

    expect((await board.call("simon", "POST", `/api/tasks/${task.id}/cancel`, { reason: "merged by hand" })).status).toBe(200)
    await nimbus.poke()
    await until(async () => fake.stopped.includes("box-1"), "the box removed at the task end")
    await close(nimbus)
  })

  test("an agent with no sandbox has no shell tool", async () => {
    const board = await cloudBoard([() => ({ tool: "bash", args: { command: "ls" } }), (request) => ({ text: request.transcript.includes("ran in") ? "it ran" : "no shell here" })])
    const nimbus = await board.host(board.fileAt("no-boxes"))
    const asked = await board.post("simon", "backend", "@nimbus list the files")
    await nimbus.poke()
    expect(await until(async () => (await board.said(asked)).length > 0 && board.said(asked), "the answer")).toEqual(["no shell here"])
    await close(nimbus)
  })
})

describe("agent tokens", () => {
  test("a token signs in as its agent; a forged, foreign or expired one is refused", async () => {
    const board = await freshBoard()
    const secret = "test-secret-for-agent-tokens-only-0123456789"
    const app = createApp(board.db, { auth: { ...authOff, mode: "on", secret } })
    await beatHostedMachine(board.db, cloudMachine)
    const made = await createApp(board.db).request("/api/agents", { method: "POST", headers: { [memberHeader]: "simon", "content-type": "application/json" }, body: JSON.stringify({ name: agent, harness: "pi-durable", machine: "cloud" }) })
    expect(made.status).toBe(200)
    const whoami = (token: string) => app.request("/api/me", { headers: { authorization: `Bearer ${token}` } })
    const good = await whoami(await issueAgentToken(secret, agent))
    expect(good.status).toBe(200)
    expect(JSON.stringify(await good.json())).toContain(`"${agent}"`)
    const token = await issueAgentToken(secret, agent)
    expect((await whoami(`${token.slice(0, -2)}xx`)).status).toBe(401)
    expect((await whoami(await issueAgentToken("another-secret-that-is-long-enough-000", agent))).status).toBe(401)
    expect((await whoami(await issueAgentToken(secret, agent, new Date(Date.now() - 60 * 60_000)))).status).toBe(401)
    expect((await whoami(await issueAgentToken(secret, "simon"))).status).toBe(401)
  })
})
