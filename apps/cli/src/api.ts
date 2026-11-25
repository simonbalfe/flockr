import { client } from "@flockr/client"
import { UsageError } from "./args"

const methods = ["get", "post", "put", "patch", "delete"] as const
type Method = (typeof methods)[number]

const httpVerb = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE" } as const satisfies Record<Method, string>

interface Parameter {
  name: string
  in: string
}

interface Operation {
  operationId: string
  summary?: string
  method: Method
  path: string
  parameters: Parameter[]
  hasBody: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function loadOperations(baseUrl: string): Promise<Operation[]> {
  const result = await client.get<Record<number, unknown>>({ url: "/api/openapi.json", baseUrl })
  if (result.error !== undefined) throw new Error(`Could not read the OpenAPI document: HTTP ${result.response?.status ?? 0}`)
  const doc: unknown = result.data
  const paths = isRecord(doc) && isRecord(doc.paths) ? doc.paths : {}
  const operations: Operation[] = []
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue
    for (const method of methods) {
      const op = item[method]
      if (!isRecord(op) || typeof op.operationId !== "string") continue
      const parameters = Array.isArray(op.parameters)
        ? op.parameters.flatMap((p) => (isRecord(p) && typeof p.name === "string" && typeof p.in === "string" ? [{ name: p.name, in: p.in }] : []))
        : []
      operations.push({
        operationId: op.operationId,
        summary: typeof op.summary === "string" ? op.summary : undefined,
        method,
        path,
        parameters,
        hasBody: isRecord(op.requestBody),
      })
    }
  }
  return operations
}

export async function callOperation(baseUrl: string, operationId: string, raw: string | undefined): Promise<unknown> {
  const operations = await loadOperations(baseUrl)
  const op = operations.find((o) => o.operationId === operationId)
  if (!op) throw new UsageError(`No operation ${operationId}. Run flockr api to list them.`)
  const parsed: unknown = raw ? JSON.parse(raw) : {}
  if (!isRecord(parsed)) throw new UsageError("--data must be a JSON object")
  const path: Record<string, unknown> = {}
  const query: Record<string, unknown> = {}
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    const param = op.parameters.find((p) => p.name === key)
    if (param?.in === "path") path[key] = value
    else if (param?.in === "query") query[key] = value
    else body[key] = value
  }
  const result = await client.request({
    method: httpVerb[op.method],
    url: op.path,
    path,
    query,
    ...(op.hasBody ? { body, headers: { "Content-Type": "application/json" } } : {}),
  })
  if (result.error !== undefined) throw new ApiFailure(result.response?.status ?? 0, result.error)
  return result.data
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(isRecord(body) && typeof body.error === "string" ? body.error : `HTTP ${status}`)
  }
}

type Result<T> = ({ data: T; error: undefined } | { data: undefined; error: unknown }) & { response?: Response }

export async function run<T>(promise: Promise<Result<T>>): Promise<NonNullable<T>> {
  const result = await promise
  const data = result.data
  if (result.error !== undefined || data === undefined || data === null) throw new ApiFailure(result.response?.status ?? 0, result.error)
  return data
}
