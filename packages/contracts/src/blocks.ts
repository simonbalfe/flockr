import { z } from "@hono/zod-openapi"
import { Sha } from "./commits"

export const blockKinds = ["approval", "deliverable", "decision", "handoff"] as const
export type BlockKind = (typeof blockKinds)[number]
export const postableBlockKinds = ["deliverable", "decision"] as const satisfies readonly BlockKind[]
export const reviewVerdicts = ["approved", "changes_requested"] as const
export const blockLimits = { perMessage: 5, textChars: 2000, files: 100, fileChars: 300, steps: 10, listed: 100 } as const

const line = z.string().trim().min(1).max(blockLimits.textChars)
const taskId = z.number().int().openapi({ example: 812 })

export const ApprovalBlock = z
  .object({
    kind: z.literal("approval"),
    task: taskId,
    verdict: z.enum(reviewVerdicts),
    commit: Sha.nullable().openapi({ description: "The commit the verdict is about; null when the task named none" }),
  })
  .openapi("ApprovalBlock", { description: "Written by the board when a task is approved or sent back; never posted by hand" })

export const DeliverableBlock = z
  .object({
    kind: z.literal("deliverable"),
    task: taskId.nullable(),
    summary: line.openapi({ example: "Users API with sign-up and tests" }),
    commit: Sha.nullable(),
    branch: z.string().trim().min(1).max(200).nullable().openapi({ example: "flockr/812" }),
    url: z.string().trim().url().max(500).nullable(),
  })
  .openapi("DeliverableBlock", { description: "Something finished: what it is, and where (commit, branch or link)" })

export const DecisionBlock = z
  .object({
    kind: z.literal("decision"),
    decision: line.openapi({ example: "Use uuid keys for users" }),
    why: line.nullable().openapi({ example: "The sign-up form makes ids before the insert" }),
    task: taskId.nullable(),
  })
  .openapi("DecisionBlock", { description: "A decision made, and why" })

export const HandoffBlock = z
  .object({
    kind: z.literal("handoff"),
    task: taskId,
    from: z.string(),
    to: z.string(),
    summary: z.string().nullable(),
    branch: z.string(),
    commit: z.string().nullable(),
    files: z.array(z.string()),
    tests: z.string().nullable(),
    nextSteps: z.array(z.string()),
  })
  .openapi("HandoffBlock", { description: "Written by the board when a task is handed off: the record the next holder starts from" })

export const Block = z.discriminatedUnion("kind", [ApprovalBlock, DeliverableBlock, DecisionBlock, HandoffBlock]).openapi("Block")
const DeliverableInput = DeliverableBlock.extend({
  task: DeliverableBlock.shape.task.default(null),
  commit: DeliverableBlock.shape.commit.default(null),
  branch: DeliverableBlock.shape.branch.default(null),
  url: DeliverableBlock.shape.url.default(null),
}).openapi("DeliverableInput")
const DecisionInput = DecisionBlock.extend({ why: DecisionBlock.shape.why.default(null), task: DecisionBlock.shape.task.default(null) }).openapi("DecisionInput")
export const PostableBlock = z.discriminatedUnion("kind", [DeliverableInput, DecisionInput]).openapi("PostableBlock")
export const Blocks = z.array(Block)
export const PostableBlocks = z
  .array(PostableBlock)
  .max(blockLimits.perMessage)
  .default([])
  .openapi({ description: `Typed blocks carried with the text, at most ${blockLimits.perMessage}: deliverable or decision. Approval and hand-off blocks are written by the board` })

export const BlockRecord = z
  .object({
    messageId: z.string().openapi({ example: "m41" }),
    threadId: z.string().openapi({ example: "812" }),
    who: z.string(),
    at: z.string().openapi({ format: "date-time" }),
    block: Block,
  })
  .openapi("BlockRecord")

export const ListBlocksQuery = z.object({
  kind: z.enum(blockKinds).optional(),
  task: z.coerce.number().int().optional().openapi({ type: "integer", description: "Only blocks about this task" }),
})

export type ApprovalBlock = z.infer<typeof ApprovalBlock>
export type DeliverableBlock = z.infer<typeof DeliverableBlock>
export type DecisionBlock = z.infer<typeof DecisionBlock>
export type HandoffBlock = z.infer<typeof HandoffBlock>
export type Block = z.infer<typeof Block>
export type PostableBlock = z.infer<typeof PostableBlock>
export type BlockRecord = z.infer<typeof BlockRecord>
export type ListBlocksQuery = z.infer<typeof ListBlocksQuery>

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : null)

export function blockSummary(block: Block): string {
  switch (block.kind) {
    case "approval":
      return `[${block.verdict === "approved" ? "approved" : "changes requested"}] #${block.task}${block.commit ? ` at ${short(block.commit)}` : ""}`
    case "deliverable":
      return `[deliverable] ${block.summary}${block.task === null ? "" : ` (#${block.task})`}${block.commit ? ` at ${short(block.commit)}` : ""}${block.branch ? ` on ${block.branch}` : ""}${block.url ? ` ${block.url}` : ""}`
    case "decision":
      return `[decision] ${block.decision}${block.why ? `, because ${block.why}` : ""}`
    case "handoff":
      return [
        `[hand-off] #${block.task} ${block.from} to ${block.to} on ${block.branch}${block.commit ? ` at ${short(block.commit)}` : ""}${block.summary ? `: ${block.summary}` : ""}`,
        ...(block.files.length ? [`files: ${block.files.join(", ")}`] : []),
        ...(block.tests ? [`tests: ${block.tests}`] : []),
        ...block.nextSteps.map((step, i) => `next ${i + 1}: ${step}`),
      ].join("; ")
    default: {
      const never: never = block
      throw new Error(`Unknown block ${JSON.stringify(never)}`)
    }
  }
}
