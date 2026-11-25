import { z } from "zod"

export const WorkerEnv = z.object({
  HYPERDRIVE: z.object({ connectionString: z.string().min(1) }),
})

export type WorkerEnv = z.infer<typeof WorkerEnv>

export interface WorkerContext {
  waitUntil: (work: Promise<unknown>) => void
}
