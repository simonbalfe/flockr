import { z } from "zod"
import { cloudflareSandbox } from "../../src/platform/cloudflare/sandbox"
import { SandboxEnv } from "../../src/platform/cloudflare/env"

export { SandboxBox, SandboxIndex } from "../../src/platform/cloudflare/sandbox-box"

const Call = z.discriminatedUnion("method", [
  z.object({ method: z.literal("start"), spec: z.looseObject({}) }),
  z.object({ method: z.literal("run"), id: z.string(), command: z.array(z.string()), options: z.looseObject({}).default({}) }),
  z.object({ method: z.literal("writeFile"), id: z.string(), path: z.string(), content: z.string() }),
  z.object({ method: z.literal("readFile"), id: z.string(), path: z.string() }),
  z.object({ method: z.literal("status"), id: z.string() }),
  z.object({ method: z.literal("logs"), id: z.string() }),
  z.object({ method: z.literal("stop"), id: z.string() }),
  z.object({ method: z.literal("list") }),
  z.object({ method: z.literal("sleep"), id: z.string() }),
])

const RunOptions = z.object({ cwd: z.string().optional(), env: z.record(z.string(), z.string()).optional(), stdin: z.string().optional(), timeoutSeconds: z.number().optional(), maxOutputBytes: z.number().optional() })
const Spec = z.object({
  image: z.string(),
  timeLimitSeconds: z.number(),
  diskMb: z.number(),
  memoryMb: z.number().optional(),
  cpus: z.number().optional(),
  network: z.enum(["none", "open"]).optional(),
  env: z.record(z.string(), z.string()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
})

const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    const sandbox = cloudflareSandbox(env)
    const bindings = SandboxEnv.parse(env)
    if (!sandbox || !bindings.SANDBOX) return new Response("no sandbox bindings", { status: 500 })
    const call = Call.parse(await request.json())
    try {
      switch (call.method) {
        case "start":
          return Response.json(await sandbox.start(Spec.parse(call.spec)))
        case "run":
          return Response.json(await sandbox.run(call.id, call.command, RunOptions.parse(call.options)))
        case "writeFile":
          await sandbox.writeFile(call.id, call.path, call.content)
          return Response.json(null)
        case "readFile": {
          const bytes = await sandbox.readFile(call.id, call.path)
          return Response.json(bytes === null ? null : base64(bytes))
        }
        case "status":
          return Response.json(await sandbox.status(call.id))
        case "logs":
          return Response.json(await sandbox.logs(call.id))
        case "stop":
          await sandbox.stop(call.id)
          return Response.json(null)
        case "list":
          return Response.json(await sandbox.list())
        case "sleep":
          return Response.json(await bindings.SANDBOX.get(bindings.SANDBOX.idFromName(call.id)).sleep())
        default: {
          const never: never = call
          throw new Error(`Unknown call ${JSON.stringify(never)}`)
        }
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
    }
  },
}
