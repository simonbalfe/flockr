import { z } from "zod"

const methods = ["get", "post", "put", "patch", "delete"] as const
type Method = (typeof methods)[number]

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

const json: z.ZodType<Json> = z.json()
const jsonObject = z.record(z.string(), json)

const parameter = z.object({
  name: z.string(),
  in: z.enum(["path", "query", "header", "cookie"]),
  required: z.boolean().optional(),
  description: z.string().optional(),
  schema: jsonObject.optional(),
})

const operation = z.object({
  operationId: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  parameters: z.array(parameter).optional(),
  requestBody: z.object({ content: z.record(z.string(), z.object({ schema: jsonObject.optional() })) }).optional(),
})

const document = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
  components: z.object({ schemas: z.record(z.string(), jsonObject).optional() }).optional(),
})

export interface OperationTool {
  name: string
  description: string
  inputSchema: { type: "object"; properties: JsonObject; required: string[] }
  annotations: { readOnlyHint: boolean }
  method: Method
  path: string
  pathParams: string[]
  queryParams: string[]
  bodyKeys: string[] | null
}

const refPrefix = "#/components/schemas/"

function inliner(schemas: Record<string, JsonObject>) {
  const value = (input: Json, trail: string[]): Json => {
    if (Array.isArray(input)) return input.map((item) => value(item, trail))
    if (input !== null && typeof input === "object") return object(input, trail)
    return input
  }
  const object = (input: JsonObject, trail: string[]): JsonObject => {
    const { $ref, ...rest } = input
    const inlined: JsonObject = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, value(v, trail)]))
    if (typeof $ref !== "string") return inlined
    const name = $ref.startsWith(refPrefix) ? $ref.slice(refPrefix.length) : ""
    const target = schemas[name]
    if (!target || trail.includes(name)) throw new Error(`Cannot inline schema reference ${$ref}`)
    return { ...object(target, [...trail, name]), ...inlined }
  }
  return (schema: JsonObject) => object(schema, [])
}

function isMethod(key: string): key is Method {
  return methods.some((method) => method === key)
}

export function operationTools(raw: unknown): Map<string, OperationTool> {
  const doc = document.parse(JSON.parse(JSON.stringify(raw)))
  const inline = inliner(doc.components?.schemas ?? {})
  const tools = new Map<string, OperationTool>()
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [key, value] of Object.entries(item)) {
      if (!isMethod(key)) continue
      const op = operation.parse(value)
      const properties: JsonObject = {}
      const required: string[] = []
      const params = (op.parameters ?? []).filter((p) => p.in === "path" || p.in === "query")
      for (const p of params) {
        properties[p.name] = inline({ ...(p.schema ?? {}), ...(p.description ? { description: p.description } : {}) })
        if (p.required || p.in === "path") required.push(p.name)
      }
      const bodySchema = op.requestBody?.content["application/json"]?.schema
      let bodyKeys: string[] | null = null
      if (bodySchema) {
        const body = inline(bodySchema)
        const bodyProps = body.properties
        const props: JsonObject = bodyProps !== null && typeof bodyProps === "object" && !Array.isArray(bodyProps) ? bodyProps : {}
        bodyKeys = Object.keys(props)
        for (const [name, schema] of Object.entries(props)) {
          if (name in properties) throw new Error(`${op.operationId}: body field ${name} clashes with a parameter`)
          properties[name] = schema
        }
        const bodyRequired = body.required
        if (Array.isArray(bodyRequired)) for (const name of bodyRequired) if (typeof name === "string") required.push(name)
      }
      tools.set(op.operationId, {
        name: op.operationId,
        description: [op.summary, op.description].filter(Boolean).join("\n\n"),
        inputSchema: { type: "object", properties, required },
        annotations: { readOnlyHint: key === "get" },
        method: key,
        path,
        pathParams: params.filter((p) => p.in === "path").map((p) => p.name),
        queryParams: params.filter((p) => p.in === "query").map((p) => p.name),
        bodyKeys,
      })
    }
  }
  return tools
}

export function toolRequest(tool: OperationTool, args: Record<string, unknown>, caller: Record<string, string>): { url: string; init: RequestInit } {
  const missing = tool.pathParams.filter((name) => args[name] === undefined || args[name] === null)
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}`)
  const path = tool.path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(String(args[name])))
  const query = new URLSearchParams()
  for (const name of tool.queryParams) {
    const value = args[name]
    if (value !== undefined && value !== null) query.set(name, String(value))
  }
  const headers: Record<string, string> = { ...caller }
  const init: RequestInit = { method: tool.method.toUpperCase(), headers }
  if (tool.bodyKeys) {
    const body: Record<string, unknown> = {}
    for (const name of tool.bodyKeys) if (args[name] !== undefined) body[name] = args[name]
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const search = query.toString()
  return { url: search ? `${path}?${search}` : path, init }
}
