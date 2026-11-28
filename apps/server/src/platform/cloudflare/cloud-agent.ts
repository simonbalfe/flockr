import { DurableObject } from "cloudflare:workers"
import type { Wake } from "@earendil-works/pi-durable"
import { DurableObjectSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/cloudflare"
import type { CloudAgent as Host } from "@flockr/runner/cloud"
import { hostCloudAgent } from "../../cloud/host"
import { modelProxySettingsFrom } from "../../model-proxy/proxy"
import { agentParam, onBoard, pokePath, serveApi } from "./api"
import { WorkerEnv, workerAuth } from "./env"

const heartbeatMs = 60_000
const agentKey = "agent"

export class CloudAgent extends DurableObject {
  private host: Promise<Host | null> | undefined
  private readonly database: DurableObjectSqliteDatabase

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    this.database = new DurableObjectSqliteDatabase(ctx.storage)
    void ctx.blockConcurrencyWhile(async () => {
      const fallback = Date.now() + heartbeatMs
      const current = await ctx.storage.getAlarm()
      if (current === null || current > fallback) await ctx.storage.setAlarm(fallback)
    })
  }

  private async arm(wake: Wake): Promise<void> {
    const heartbeat = wake.active ? Date.now() + heartbeatMs : undefined
    const at = heartbeat === undefined || wake.at === undefined ? (heartbeat ?? wake.at) : Math.min(heartbeat, wake.at)
    if (at === undefined) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(at)
  }

  private open(agent: string): Promise<Host | null> {
    this.host ??= (async () => {
      const env = WorkerEnv.parse(this.env)
      const secret = workerAuth(env, null).secret
      const host = await hostCloudAgent({
        agent,
        serve: (request) => serveApi(env, this.ctx, request, agent),
        withDb: (run) => onBoard(env, this.ctx, { run, delivered: () => true, from: agent }),
        secret,
        database: this.database,
        model: { ready: modelProxySettingsFrom(env, secret) !== null, defaultModel: env.FLOCKR_CLOUD_MODEL ?? null },
        log: (line) => console.log(line),
        wakes: {
          onWake: (wake) => void this.arm(wake).catch(() => this.ctx.abort("Alarm write failed")),
          arm: (wake) => this.arm(wake),
        },
      })
      if (host) await host.start()
      return host
    })().catch((error: unknown) => {
      this.host = undefined
      throw error
    })
    return this.host
  }

  private agentName(request: Request | null): string | null {
    const named = request ? new URL(request.url).searchParams.get(agentParam) : null
    if (named) {
      this.ctx.storage.kv.put(agentKey, named)
      return named
    }
    const kept = this.ctx.storage.kv.get(agentKey)
    return typeof kept === "string" ? kept : null
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== "POST" || url.pathname !== pokePath) return new Response("Not found", { status: 404 })
    const agent = this.agentName(request)
    if (!agent) return new Response("No agent", { status: 400 })
    const host = await this.open(agent)
    if (!host) {
      await this.ctx.storage.deleteAlarm()
      return new Response(null, { status: 204 })
    }
    await host.poke()
    return new Response(null, { status: 204 })
  }

  override async alarm(): Promise<void> {
    const agent = this.agentName(null)
    if (!agent) return
    const host = await this.open(agent)
    if (!host) return
    await host.alarm()
  }
}
