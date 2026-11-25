import { z } from "zod"

export const bridgeServer = "flockr"
export const bridgeTool = "approve"

const Request = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
})

const CallParams = z.object({ name: z.string(), arguments: z.unknown().optional() })

const toolList = [
  {
    name: bridgeTool,
    description: "Asks a person on the Flockr board whether the agent may use a tool, and returns their answer.",
    inputSchema: {
      type: "object",
      properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } },
      required: ["tool_name", "input"],
    },
  },
]

type Approve = (args: unknown) => Promise<unknown>

export function mcpHandler(approve: Approve): (line: string) => Promise<string | null> {
  const reply = (id: string | number, body: { result: unknown } | { error: { code: number; message: string } }) => JSON.stringify({ jsonrpc: "2.0", id, ...body })
  return async (line) => {
    const parsed = Request.safeParse(JSON.parse(line))
    if (!parsed.success) return null
    const { id, method, params } = parsed.data
    if (id === undefined) return null
    switch (method) {
      case "initialize": {
        const version = typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18"
        return reply(id, { result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: "flockr-runner", version: "0.1.0" } } })
      }
      case "ping":
        return reply(id, { result: {} })
      case "tools/list":
        return reply(id, { result: { tools: toolList } })
      case "tools/call": {
        const call = CallParams.safeParse(params)
        if (!call.success || call.data.name !== bridgeTool) return reply(id, { error: { code: -32602, message: "Unknown tool" } })
        const decision = await approve(call.data.arguments)
        return reply(id, { result: { content: [{ type: "text", text: JSON.stringify(decision) }] } })
      }
      default:
        return reply(id, { error: { code: -32601, message: `Method ${method} is not supported` } })
    }
  }
}

export async function serveStdio(handle: (line: string) => Promise<string | null>): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ""
  const respond = (line: string) => {
    handle(line)
      .then((out) => {
        if (out !== null) process.stdout.write(`${out}\n`)
      })
      .catch((error: unknown) => console.error("bridge request failed", error))
  }
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true })
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end).trim()
      buffer = buffer.slice(end + 1)
      if (line) respond(line)
    }
  }
}
