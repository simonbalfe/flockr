import { memberHeader } from "@flockr/contracts"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { operationTools, toolRequest, type OperationTool } from "./tools"

export interface McpOptions {
  document: () => unknown
  dispatch: (url: string, init: RequestInit) => Promise<Response>
  defaultMember: string
}

const args = z.record(z.string(), z.unknown())

async function callTool(tool: OperationTool, input: unknown, member: string, options: McpOptions): Promise<CallToolResult> {
  const parsed = args.safeParse(input ?? {})
  if (!parsed.success) return { isError: true, content: [{ type: "text", text: "Arguments must be an object" }] }
  let request: { url: string; init: RequestInit }
  try {
    request = toolRequest(tool, parsed.data, member)
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] }
  }
  const response = await options.dispatch(request.url, request.init)
  const text = await response.text()
  if (!response.ok) return { isError: true, content: [{ type: "text", text }] }
  const body: unknown = text ? JSON.parse(text) : null
  const structured = body !== null && typeof body === "object" && !Array.isArray(body) ? { structuredContent: args.parse(body) } : {}
  return { content: [{ type: "text", text }], ...structured }
}

export function mcpHandler(options: McpOptions) {
  let tools: Map<string, OperationTool> | undefined
  const allTools = () => (tools ??= operationTools(options.document()))

  return async (request: Request): Promise<Response> => {
    const member = request.headers.get(memberHeader) ?? new URL(request.url).searchParams.get("as") ?? options.defaultMember
    const server = new Server({ name: "flockr", version: "0.1.0" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [...allTools().values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      })),
    }))
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const tool = allTools().get(params.name)
      if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool ${params.name}` }] }
      return callTool(tool, params.arguments, member, options)
    })
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(request)
  }
}
