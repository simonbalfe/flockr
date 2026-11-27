import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AgentPermissions } from "@flockr/contracts/agents"
import type { ApprovalVerdict } from "@flockr/contracts/approvals"
import type { BoardPort } from "../src/board"
import { ConfigError, folderFor, parseConfig } from "../src/config"
import { permissionGate, type AnswerWatch } from "../src/gate"
import { claudeArgs, claudeCode } from "../src/harness/claude-code"
import { harnessFor } from "../src/harness/registry"
import { mcpHandler } from "../src/mcp"
import { commandIsFree, decide, defaultRule, ruleFor, shellWords, withBoard, type ToolRequest } from "../src/permissions"
import { conversationPrompt, instructions, workPrompt } from "../src/prompt"
import { routeReply, startsConversation } from "../src/routing"
import { emptyState, jsonStore, RunnerState } from "../src/store"
import { event, fakeBoard, member, messageThread, reply, task } from "./fakes"

const valid = { board: "http://localhost:5173", channels: { general: "/tmp" }, maxSessions: 2, maxMinutes: 30 }

describe("config", () => {
  test("a valid config parses, with defaults for the limits", () => {
    const { maxSessions, maxMinutes, ...rest } = valid
    expect(parseConfig(rest, () => true)).toMatchObject({ maxSessions: 2, maxMinutes: 30 })
    expect(maxSessions + maxMinutes).toBe(32)
  })

  test("a channel folder that does not exist is refused", () => {
    expect(() => parseConfig(valid, () => false)).toThrow(ConfigError)
    expect(() => parseConfig(valid, () => false)).toThrow("channels.general: folder /tmp does not exist")
  })

  test("a relative folder is refused; an empty file is all defaults", () => {
    expect(() => parseConfig({ ...valid, channels: { general: "relative/path" } }, () => true)).toThrow("absolute path")
    expect(parseConfig({}, () => true)).toEqual({ board: "http://localhost:5173", channels: {}, maxSessions: 2, maxMinutes: 30, saveSessions: false })
  })

  test("a channel with no folder has none", () => {
    expect(folderFor(parseConfig(valid, () => true), "random")).toBeNull()
  })
})

const bash = (command: string): ToolRequest => ({ kind: "command", tool: "Bash", command, input: { command } })

describe("permission rule", () => {
  test("file reads and edits are free; read only refuses edits and still lets free commands run", () => {
    expect(decide({ kind: "edit", tool: "Write", command: null, input: {} })).toBe("allow")
    expect(decide({ kind: "read", tool: "Grep", command: null, input: {} })).toBe("allow")
    const readOnly = ruleFor("read-only")
    expect(decide({ kind: "edit", tool: "Write", command: null, input: {} }, readOnly)).toBe("deny")
    expect(decide({ kind: "read", tool: "Grep", command: null, input: {} }, readOnly)).toBe("allow")
    expect(decide(bash("git status"), readOnly)).toBe("allow")
    expect(decide(bash("date"), readOnly)).toBe("ask")
  })

  test("the board CLI and read-only git and ls are free", () => {
    for (const command of ["flockr reply m12 \"Done (file created); see it!\"", "flockr tasks submit 830 --note 'tests pass'", "fc thread m12 --json", "git status", "git diff --stat", "git log --oneline -5", "ls -la src"]) {
      expect(decide(bash(command))).toBe("allow")
    }
  })

  test("any other command asks, and so does anything that chains or escapes", () => {
    for (const command of ["date", "rm -rf build", "fc --as simon answer m12 Allow", "flockr --as simon answer m12 Allow", "fc --url=http://x reply 1 hi", "FC_AS=simon fc answer m12 Allow", "ls; rm x", "fc reply m12 \"$(whoami)\"", "git diff --output=/tmp/x", "git push", "ls `pwd`", "fc reply m12 'unterminated"]) {
      expect(decide(bash(command))).toBe("ask")
    }
    expect(decide({ kind: "other", tool: "WebFetch", command: null, input: {} })).toBe("ask")
  })

  test("shell words keep quoted text together", () => {
    expect(shellWords(`fc reply m12 "a b" 'c d'`)).toEqual(["fc", "reply", "m12", "a b", "c d"])
    expect(commandIsFree(`fc reply m12 "--as is fine inside text"`)).toBe(true)
  })
})

describe("permission gate", () => {
  const watchWith = (option: string): (() => Promise<AnswerWatch>) => async () => ({ answerTo: async () => ({ option, by: "simon" }), close: () => undefined })
  const asking = (base: BoardPort, asked: string[]): BoardPort => ({
    ...base,
    ask: async (thread, question) => {
      asked.push(`${thread}: ${question.text}`)
      return { kind: "asked", question: { kind: "question", id: "m40", threadId: thread, channel: "general", who: member, at: "", question, answer: null, answeredBy: null } }
    },
  })
  const args = (command: string) => ({ tool_name: "Bash", input: { command } })

  test("a free command is allowed without a question", async () => {
    const asked: string[] = []
    const gate = permissionGate({ board: asking(fakeBoard().port, asked), codec: claudeCode.permissions, thread: "m10", channel: "general", watch: watchWith("Allow once"), log: () => undefined })
    expect(await gate(args("git status"))).toEqual({ behavior: "allow", updatedInput: { command: "git status" } })
    expect(asked).toEqual([])
  })

  test("another command becomes a question card; Allow once runs it, Deny refuses it", async () => {
    const asked: string[] = []
    const allow = permissionGate({ board: asking(fakeBoard().port, asked), codec: claudeCode.permissions, thread: "m10", channel: "general", watch: watchWith("Allow once"), log: () => undefined })
    expect(await allow(args("date"))).toEqual({ behavior: "allow", updatedInput: { command: "date" } })
    expect(asked).toEqual(["m10: Run `date`?"])
    const deny = permissionGate({ board: asking(fakeBoard().port, asked), codec: claudeCode.permissions, thread: "m10", channel: "general", watch: watchWith("Deny"), log: () => undefined })
    expect(await deny(args("date"))).toMatchObject({ behavior: "deny" })
  })

  test("when the board refuses the question the command is denied", async () => {
    const gate = permissionGate({ board: fakeBoard().port, codec: claudeCode.permissions, thread: "m10", channel: "general", watch: watchWith("Allow once"), log: () => undefined })
    expect(await gate(args("date"))).toMatchObject({ behavior: "deny" })
    expect(await gate({ nonsense: true })).toMatchObject({ behavior: "deny" })
  })

  test("the channel's approval rule decides a command, and the stricter of it and the agent's own setting wins", async () => {
    const rules: Record<string, ApprovalVerdict> = { backend: "allow", platform: "block" }
    const checked: string[] = []
    const asked: string[] = []
    const board: BoardPort = {
      ...asking(fakeBoard().port, asked),
      approval: async (kind, channel) => {
        checked.push(`${kind} ${channel}`)
        return rules[channel] ?? "ask"
      },
    }
    const gateFor = (channel: string, permissions: AgentPermissions) =>
      permissionGate({ board, codec: claudeCode.permissions, thread: "m10", channel, watch: watchWith("Deny"), log: () => undefined, permissions })
    const outcome = async (channel: string, permissions: AgentPermissions, request: unknown) => {
      asked.length = 0
      const result = await gateFor(channel, permissions)(request)
      return `${JSON.stringify(result).includes('"allow"') ? "allow" : "deny"}${asked.length ? " after asking" : ""}`
    }
    expect(await outcome("backend", "edit-free-commands-ask", args("date"))).toBe("allow")
    expect(await outcome("general", "edit-free-commands-ask", args("date"))).toBe("deny after asking")
    expect(await outcome("platform", "edit-free-commands-ask", args("date"))).toBe("deny")
    expect(await outcome("backend", "read-only", args("date"))).toBe("deny after asking")
    expect(await outcome("platform", "read-only", args("date"))).toBe("deny")
    expect(await outcome("platform", "edit-free-commands-ask", args("git status"))).toBe("allow")
    expect(await outcome("backend", "read-only", { tool_name: "Write", input: { file_path: "a.ts" } })).toBe("deny")
    expect(checked).toEqual(["command backend", "command general", "command platform", "command backend", "command platform"])
    expect(withBoard("edit-free-commands-ask", "ask")).toBe("ask")
  })
})

describe("the claude-code adapter", () => {
  test("it is found by name and declares resume and streaming", () => {
    expect(harnessFor("claude-code").capabilities).toEqual({ resume: true, streaming: true })
    expect(() => harnessFor("other")).toThrow("No harness other")
  })

  test("its flags ask about commands through the bridge and never skip permissions", () => {
    const spec = { title: "flockr m10", prompt: "hi", instructions: "be brief", folder: "/tmp", env: {}, resumeId: null, bridge: { command: "bun", args: ["bridge.ts"], env: {} }, timeLimitMs: 60_000, rule: defaultRule, thread: "m10", personality: null, model: null, activity: () => undefined, claim: null, saver: null }
    const flags = claudeArgs(spec, "abc")
    expect(flags).toContain("--permission-prompt-tool")
    expect(flags[flags.indexOf("--permission-prompt-tool") + 1]).toBe("mcp__flockr__approve")
    expect(flags[flags.indexOf("--permission-mode") + 1]).toBe("manual")
    expect(flags[flags.indexOf("--allowedTools") + 1]).toBe("Read,Glob,Grep,Edit,Write,NotebookEdit")
    expect(flags.join(" ")).not.toContain("dangerously")
    expect(flags.slice(-2)).toEqual(["--session-id", "abc"])
    expect(claudeArgs({ ...spec, resumeId: "abc" }, "abc").slice(-2)).toEqual(["--resume", "abc"])
    const readOnly = claudeArgs({ ...spec, rule: ruleFor("read-only") }, "abc")
    expect(readOnly[readOnly.indexOf("--allowedTools") + 1]).toBe("Read,Glob,Grep")
  })
})

describe("the bridge MCP server", () => {
  test("it lists one tool and returns the decision as text", async () => {
    const handle = mcpHandler(async () => ({ behavior: "allow" }))
    const send = async (body: object): Promise<unknown> => JSON.parse((await handle(JSON.stringify({ jsonrpc: "2.0", ...body }))) ?? "null")
    expect(await send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18" } })
    expect(await send({ id: 2, method: "tools/list" })).toMatchObject({ result: { tools: [{ name: "approve" }] } })
    expect(await send({ id: 3, method: "tools/call", params: { name: "approve", arguments: {} } })).toMatchObject({ result: { content: [{ type: "text", text: JSON.stringify({ behavior: "allow" }) }] } })
    expect(await send({ id: 4, method: "tools/call", params: { name: "other" } })).toMatchObject({ error: { code: -32602 } })
    expect(await handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toBeNull()
  })
})

describe("prompts", () => {
  test("instructions carry the board skill without its frontmatter and the runner rules", () => {
    const text = instructions({ member, skill: "---\nname: flockr\n---\n\n# Working on a Flockr board\n" })
    expect(text).toContain("# Working on a Flockr board")
    expect(text).not.toContain("name: flockr")
    expect(text).toContain("Never pass --as or --url")
  })

  test("a conversation prompt holds the thread; a work prompt holds title, spec and how to finish", () => {
    const thread = messageThread("m10", "simon", "@claude say hello", [reply("m11", "tim", "in French")])
    expect(conversationPrompt(thread)).toContain("simon: @claude say hello\ntim: in French")
    const work = workPrompt({ task: task({ id: 830, spec: "SPEC_HEALTH.md" }), thread: { id: "830", channel: "general", taskId: 830, root: null, entries: [] } })
    expect(work).toContain("Title: Add a health check")
    expect(work).toContain("Spec: SPEC_HEALTH.md")
    expect(work).toContain("flockr tasks submit 830")
    expect(work).toContain("flockr tasks release 830")
  })
})

describe("routing", () => {
  test("only a top-level mention of the member by someone else starts a conversation", () => {
    expect(startsConversation(event({ type: "message.posted", actor: "simon", messageId: "m1", data: { mentions: [member] } }), member)).toBe(true)
    expect(startsConversation(event({ type: "message.posted", actor: "simon", messageId: "m1", data: { mentions: ["codex"] } }), member)).toBe(false)
    expect(startsConversation(event({ type: "message.posted", actor: member, messageId: "m1", data: { mentions: [member] } }), member)).toBe(false)
  })

  test("replies route by whether the member joined the thread", () => {
    expect(routeReply({ member, thread: messageThread("m1", "simon", "lunch?"), task: null })).toBe("ignore")
    expect(routeReply({ member, thread: messageThread("m1", "simon", "@claude hi"), task: null })).toBe("converse")
    expect(routeReply({ member, thread: messageThread("m1", "simon", "lunch?", [reply("m2", member, "Sure.")]), task: null })).toBe("converse")
    const taskThread = { id: "830", channel: "general", taskId: 830, root: null, entries: [] }
    expect(routeReply({ member, thread: taskThread, task: task({ id: 830 }) })).toBe("work")
    expect(routeReply({ member, thread: taskThread, task: task({ id: 830, state: "review" }) })).toBe("converse")
    expect(routeReply({ member, thread: taskThread, task: task({ id: 830, state: "review", assignee: "codex" }) })).toBe("ignore")
  })
})

describe("session store", () => {
  test("a missing or broken file reads as empty, and a write reads back", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "flockr-runner-"))
    const file = path.join(dir, "state.json")
    expect(jsonStore(file, RunnerState, emptyState).get()).toEqual(emptyState)
    writeFileSync(file, "not json")
    expect(jsonStore(file, RunnerState, emptyState).get()).toEqual(emptyState)
    jsonStore(file, RunnerState, emptyState).set({ lastSeq: 41 })
    expect(jsonStore(file, RunnerState, emptyState).get()).toEqual({ lastSeq: 41 })
  })
})
