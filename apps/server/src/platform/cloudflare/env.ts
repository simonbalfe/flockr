import { z } from "zod"

export const WorkerEnv = z.object({
  HYPERDRIVE: z.object({ connectionString: z.string().min(1) }),
  BOARD_ROOM: z.custom<DurableObjectNamespace>((value) => typeof value === "object" && value !== null && "idFromName" in value),
})

export type WorkerEnv = z.infer<typeof WorkerEnv>
