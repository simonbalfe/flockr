import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import type { BoardEvent, TaskState } from "@flockr/client"
import { isLive, sandboxWorkspace, type SandboxProvider, type SandboxSpec } from "@flockr/sandbox/sandbox"
import { boxExecutionEnv } from "../harness/pi/box-env"
import type { HostState } from "../harness/pi/database-store"
import { eventData } from "../routing"

export interface BoxPlan {
  provider: SandboxProvider
  spec: SandboxSpec
}

export const endsTaskBox = { waiting: false, ready: false, claimed: false, blocked: false, review: false, done: true, failed: false, canceled: true } as const satisfies Record<TaskState, boolean>

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 200)

export function boxPool(deps: { plan: BoxPlan; state: HostState; member: string; log: (line: string) => void }) {
  const { plan, state, member, log } = deps
  const { provider } = plan
  const opening = new Map<string, Promise<string>>()
  const key = (thread: string) => `box:${thread}`

  async function live(id: string): Promise<boolean> {
    const info = await provider.status(id)
    return isLive[info.state] && info.expiresAt.getTime() > Date.now()
  }

  async function open(thread: string): Promise<string> {
    const kept = await state.read(key(thread))
    if (kept && (await live(kept))) return kept
    if (kept) await provider.stop(kept).catch((error: unknown) => log(`${member}: could not remove the old box ${kept}: ${short(error)}`))
    const box = await provider.start({ ...plan.spec, labels: { ...(plan.spec.labels ?? {}), agent: member, thread } })
    await state.write(key(thread), box.id)
    log(`${member}: made box ${box.id} for thread ${thread}`)
    return box.id
  }

  function boxFor(thread: string): Promise<string> {
    const running = opening.get(thread)
    if (running) return running
    const work = open(thread).finally(() => opening.delete(thread))
    opening.set(thread, work)
    return work
  }

  async function end(thread: string): Promise<void> {
    const kept = await state.read(key(thread))
    if (!kept) return
    await provider.stop(kept)
    await state.clear(key(thread))
    log(`${member}: removed box ${kept} for thread ${thread}`)
  }

  return {
    async envFor(thread: string): Promise<ExecutionEnv> {
      return boxExecutionEnv({ box: provider, id: await boxFor(thread), cwd: sandboxWorkspace })
    },
    end,
    async receive(event: BoardEvent): Promise<void> {
      if (event.taskId === null) return
      const ended = eventData(event).state
      if (!ended || !endsTaskBox[ended]) return
      await end(event.threadId ?? String(event.taskId)).catch((error: unknown) => log(`${member}: could not remove the box for task #${event.taskId}: ${short(error)}`))
    },
  }
}

export type BoxPool = ReturnType<typeof boxPool>
