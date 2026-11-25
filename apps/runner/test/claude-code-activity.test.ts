import { describe, expect, test } from "bun:test"
import { applyActivityUpdates, startActivity, type ActivityState } from "@flockr/contracts"
import { claudeActivity } from "../src/harness/claude-code-activity"

const session = "6f1c2d4e-0000-4000-8000-000000000001"
const assistant = (content: unknown[], parent: string | null = null) => ({ type: "assistant", message: { id: "msg_1", role: "assistant", content }, parent_tool_use_id: parent, session_id: session })
const toolResult = (id: string, content: unknown, isError = false, parent: string | null = null) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  parent_tool_use_id: parent,
  session_id: session,
})

const transcript = [
  { type: "system", subtype: "init", cwd: "/tmp/shop", session_id: session, tools: ["Bash", "Read", "Edit"], model: "a-model" },
  assistant([{ type: "thinking", thinking: "The limiter belongs in the middleware.", signature: "sig" }]),
  assistant([{ type: "text", text: "I'll read the middleware first." }]),
  assistant([{ type: "tool_use", id: "toolu_read", name: "Read", input: { file_path: "/tmp/shop/src/app.ts" } }]),
  toolResult("toolu_read", [{ type: "text", text: "     1\texport const app = new Hono()" }]),
  assistant([
    {
      type: "tool_use",
      id: "toolu_todo",
      name: "TodoWrite",
      input: {
        todos: [
          { content: "Read the middleware", status: "completed", activeForm: "Reading" },
          { content: "Write the limiter", status: "in_progress", activeForm: "Writing" },
          { content: "Run the tests", status: "pending", activeForm: "Running" },
        ],
      },
    },
  ]),
  toolResult("toolu_todo", "Todos have been modified successfully"),
  assistant([{ type: "tool_use", id: "toolu_edit", name: "Edit", input: { file_path: "/tmp/shop/src/app.ts", old_string: "const app = new Hono()", new_string: "const app = new Hono()\napp.use(limit())" } }]),
  toolResult("toolu_edit", "The file /tmp/shop/src/app.ts has been updated."),
  assistant([{ type: "tool_use", id: "toolu_task", name: "Task", input: { description: "Find the routes", prompt: "List every route", subagent_type: "explorer" } }]),
  assistant([{ type: "tool_use", id: "toolu_inner", name: "Grep", input: { pattern: "app.get" } }], "toolu_task"),
  toolResult("toolu_inner", "src/app.ts", false, "toolu_task"),
  toolResult("toolu_task", [{ type: "text", text: "Two routes: /health and /orders." }]),
  assistant([{ type: "tool_use", id: "toolu_bash", name: "Bash", input: { command: "bun test", description: "Run the tests" } }]),
  toolResult("toolu_bash", "Exit code 1\n2 fail", true),
  assistant([{ type: "text", text: "Rate limiting is in; two tests fail." }]),
  { type: "result", subtype: "success", is_error: false, result: "Rate limiting is in; two tests fail.", session_id: session },
]

const isCommand = (tool: string) => (tool === "Bash" ? "command" : tool === "Edit" ? "edit" : "read")

function replay(lines: unknown[]): { updates: ReturnType<ReturnType<typeof claudeActivity>["read"]>; state: ActivityState } {
  const mapper = claudeActivity({ cwd: "/tmp/shop", kindOf: isCommand })
  const updates = lines.flatMap((line) => mapper.read(line))
  const started = startActivity({ title: "Answering", runId: session, key: session, parts: [] }, "2026-11-25T10:00:00.000Z")
  if (!started.ok) throw new Error(started.error)
  const applied = applyActivityUpdates(started.state, updates, "2026-11-25T10:00:05.000Z")
  if (!applied.ok) throw new Error(applied.error)
  return { updates, state: applied.state }
}

describe("the claude-code stream mapping", () => {
  test("a stream-json transcript becomes steps the reducer accepts, in order", () => {
    const { updates, state } = replay(transcript)
    expect(updates.map((u) => (u.type === "part.set" ? `set ${u.part.type}` : u.type === "run.finished" ? u.type : `${u.type} ${u.partId}`))).toEqual([
      "set reasoning",
      "set reasoning",
      "set tool",
      "part.finished toolu_read",
      "set plan",
      "set tool",
      "part.finished toolu_edit",
      "set files",
      "set subagent",
      "part.append toolu_task",
      "part.finished toolu_task",
      "set terminal",
      "part.finished toolu_bash",
    ])
    expect(state.parts.map((p) => p.type)).toEqual(["reasoning", "reasoning", "tool", "plan", "tool", "files", "subagent", "terminal"])
    expect(state.parts[0]).toMatchObject({ type: "reasoning", text: "The limiter belongs in the middleware.", status: "ok" })
    expect(state.parts[1]).toMatchObject({ type: "reasoning", text: "I'll read the middleware first." })
    expect(state.parts[2]).toMatchObject({ id: "toolu_read", type: "tool", name: "Read", input: { file_path: "/tmp/shop/src/app.ts" }, status: "ok", output: "     1\texport const app = new Hono()" })
    expect(state.parts[3]).toMatchObject({
      id: "plan",
      steps: [
        { text: "Read the middleware", status: "done" },
        { text: "Write the limiter", status: "doing" },
        { text: "Run the tests", status: "pending" },
      ],
    })
    expect(state.parts[5]).toMatchObject({ type: "files", files: [{ path: "/tmp/shop/src/app.ts", added: 2, removed: 1 }] })
    expect(state.parts[6]).toMatchObject({ type: "subagent", name: "explorer", task: "Find the routes", summary: "Two routes: /health and /orders.", status: "ok" })
    expect(state.parts[7]).toMatchObject({ type: "terminal", command: "bun test", cwd: "/tmp/shop", status: "error", exitCode: 1, output: "Exit code 1\n2 fail" })
  })

  test("the final answer is not repeated as a step, and a subagent's own steps stay inside it", () => {
    const { state } = replay(transcript)
    const texts = state.parts.flatMap((p) => (p.type === "reasoning" ? [p.text] : []))
    expect(texts).not.toContain("Rate limiting is in; two tests fail.")
    expect(state.parts.some((p) => p.id === "toolu_inner")).toBe(false)
  })

  test("a failed run adds an error step; lines it does not know change nothing", () => {
    const { state } = replay([{ type: "stream_event", event: {} }, "not json", { type: "result", subtype: "error_max_turns", is_error: true, result: "" }])
    expect(state.parts).toEqual([expect.objectContaining({ type: "error", name: "error_max_turns", message: "error_max_turns" })])
  })

  test("an entry never gets more parts than it can hold", () => {
    const calls = Array.from({ length: 250 }, (_, i) => assistant([{ type: "tool_use", id: `toolu_${i}`, name: "Read", input: { file_path: `/tmp/${i}` } }]))
    const results = Array.from({ length: 250 }, (_, i) => toolResult(`toolu_${i}`, "ok"))
    const { state } = replay([...calls, ...results])
    expect(state.parts).toHaveLength(200)
    expect(state.parts.every((p) => p.type === "tool" && p.status === "ok")).toBe(true)
  })
})
