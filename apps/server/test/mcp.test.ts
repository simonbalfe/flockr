import { describe, expect, test } from "bun:test"
import { ClaimResult, memberHeader } from "@flockr/contracts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { freshBoard } from "./harness"

const methods = ["get", "post", "put", "patch", "delete"]

describe("MCP", () => {
  test("tools/list has one tool per OpenAPI operation and a tool call runs the real route", async () => {
    const { app } = await freshBoard()
    const doc = app.document()
    const operationIds = Object.values(doc.paths ?? {}).flatMap((item) =>
      Object.entries(item ?? {}).flatMap(([method, op]) =>
        methods.includes(method) && typeof op === "object" && op !== null && "operationId" in op && typeof op.operationId === "string" ? [op.operationId] : [],
      ),
    )
    expect(operationIds.length).toBeGreaterThan(25)

    const transport = new StreamableHTTPClientTransport(new URL("http://flockr.test/mcp"), {
      fetch: (input, init) => Promise.resolve(app.request(input instanceof Request ? input : String(input), init)),
      requestInit: { headers: { [memberHeader]: "claude" } },
    })
    const client = new Client({ name: "test", version: "1.0.0" })
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...operationIds].sort())
    const claim = tools.find((t) => t.name === "claimNextTask")
    expect(claim?.description).toContain("Claim the oldest ready task")

    const result = await client.callTool({ name: "claimNextTask", arguments: { labels: ["schema"] } })
    expect(result.isError).toBeFalsy()
    expect(ClaimResult.parse(result.structuredContent).task).toMatchObject({ id: 806, holder: "claude" })

    const reply = await client.callTool({ name: "replyToThread", arguments: { id: "806", text: "Reading the spec", epoch: 1 } })
    expect(reply.isError).toBeFalsy()
    const stale = await client.callTool({ name: "completeTask", arguments: { id: 806, epoch: 7 } })
    expect(stale.isError).toBe(true)
    await client.close()
  })
})
