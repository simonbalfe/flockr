import { randomUUID } from "node:crypto"
import { z } from "zod"
import { bridgeServer, bridgeTool } from "../mcp"
import { claudeActivity } from "./claude-code-activity"
import type { PermissionRule, ToolKind, ToolRequest } from "../permissions"
import type { Harness, PermissionCodec, Session, SessionExit, SessionSpec, SessionStatus } from "./types"

const toolKind: Record<string, ToolKind> = {
  Read: "read",
  Glob: "read",
  Grep: "read",
  Edit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Bash: "command",
}

const freeTools = (rule: PermissionRule) =>
  Object.entries(toolKind)
    .filter(([, kind]) => rule[kind] === "allow")
    .map(([tool]) => tool)

const binaryName = "claude"

const OutputLine = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  session_id: z.string().optional(),
  result: z.string().optional(),
  is_error: z.boolean().optional(),
})

const PromptArgs = z.object({ tool_name: z.string(), input: z.record(z.string(), z.unknown()) })

const codec: PermissionCodec = {
  read(args) {
    const parsed = PromptArgs.safeParse(args)
    if (!parsed.success) return null
    const { tool_name: tool, input } = parsed.data
    const kind = toolKind[tool] ?? "other"
    const command = kind === "command" && typeof input.command === "string" ? input.command : null
    return { kind, tool, command, input }
  },
  allow: (request: ToolRequest) => ({ behavior: "allow", updatedInput: request.input }),
  deny: (message: string) => ({ behavior: "deny", message }),
}

export function claudeArgs(spec: SessionSpec, sessionId: string): string[] {
  const mcp = { mcpServers: { [bridgeServer]: { type: "stdio", command: spec.bridge.command, args: spec.bridge.args, env: spec.bridge.env } } }
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "manual",
    "--setting-sources",
    "project,local",
    "--allowedTools",
    freeTools(spec.rule).join(","),
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify(mcp),
    "--permission-prompt-tool",
    `mcp__${bridgeServer}__${bridgeTool}`,
    "--append-system-prompt",
    spec.instructions,
    "--name",
    spec.title,
    ...(spec.resumeId === null ? ["--session-id", sessionId] : ["--resume", spec.resumeId]),
  ]
}

function jsonOrNull(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const userLine = (text: string) => `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`

const oneLine = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > 300 ? `${line.slice(0, 297)}...` : line
}

function start(spec: SessionSpec): Session {
  const id = spec.resumeId ?? randomUUID()
  const binary = Bun.which(binaryName, { PATH: spec.env.PATH ?? "" }) ?? binaryName
  const proc = Bun.spawn({
    cmd: [binary, ...claudeArgs(spec, id)],
    cwd: spec.folder,
    env: { ...spec.env, MCP_TOOL_TIMEOUT: String(spec.timeLimitMs) },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  let open = true
  let inFlight = 0
  let stopped = false
  let status: SessionStatus = "running"
  const seen: { last: z.infer<typeof OutputLine> | null } = { last: null }
  const activity = claudeActivity({ cwd: spec.folder, kindOf: (tool) => toolKind[tool] ?? "other" })

  const write = (text: string) => {
    inFlight += 1
    proc.stdin.write(userLine(text))
    void proc.stdin.flush()
  }
  const close = () => {
    if (!open) return
    open = false
    void proc.stdin.end()
  }

  const readOut = async () => {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true })
      for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
        const raw = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (!raw) continue
        const value = jsonOrNull(raw)
        const updates = activity.read(value)
        if (updates.length) spec.activity(updates)
        const parsed = OutputLine.safeParse(value)
        if (!parsed.success || parsed.data.type !== "result") continue
        seen.last = parsed.data
        inFlight -= 1
        if (inFlight <= 0) close()
      }
    }
  }

  const exit = (async (): Promise<SessionExit> => {
    const [code, errText] = await Promise.all([proc.exited, new Response(proc.stderr).text(), readOut().catch(() => undefined)])
    status = "exited"
    if (stopped) return { kind: "stopped" }
    const result = seen.last
    if (code === 0 && result && !result.is_error) return { kind: "finished", text: result.result ?? "" }
    if (result?.is_error) return { kind: "failed", error: oneLine(result.result || result.subtype || "the run reported an error") }
    const lastLine = errText.trim().split("\n").at(-1) ?? ""
    return { kind: "failed", error: oneLine(lastLine || `exit code ${code}`) }
  })()

  write(spec.prompt)

  return {
    id,
    exit,
    send(text) {
      if (!open || status === "exited") return false
      write(text)
      return true
    },
    stop() {
      if (status === "exited") return
      stopped = true
      close()
      proc.kill("SIGTERM")
      setTimeout(() => {
        if (status === "running") proc.kill("SIGKILL")
      }, 5000)
    },
    status: () => status,
  }
}

export const claudeCode: Harness = {
  name: "claude-code",
  label: "Claude Code",
  capabilities: { resume: true, streaming: true },
  probe: (env) => (Bun.which(binaryName, { PATH: env.PATH }) ? { kind: "available" } : { kind: "missing", reason: `${binaryName} is not on the PATH` }),
  passEnv: ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "CLAUDE_CONFIG_DIR"],
  permissions: codec,
  start,
}
