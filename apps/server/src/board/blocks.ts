import { blockLimits, Blocks, type Block, type BlockRecord, type ListBlocksQuery } from "@flockr/contracts"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import type { Executor } from "../db/client"
import { messages } from "../db/schema"
import { messageKey, requireChannel, threadKeyOf } from "./read"

const matches = (block: Block, query: ListBlocksQuery) => (query.kind === undefined || block.kind === query.kind) && (query.task === undefined || ("task" in block && block.task === query.task))

export async function listBlocks(db: Executor, channel: string, query: ListBlocksQuery): Promise<BlockRecord[]> {
  await requireChannel(db, channel)
  const wanted = { ...(query.kind ? { kind: query.kind } : {}), ...(query.task === undefined ? {} : { task: query.task }) }
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.channel, channel), isNull(messages.deletedAt), sql`${messages.blocks} @> ${JSON.stringify([wanted])}::jsonb`))
    .orderBy(desc(messages.id))
    .limit(blockLimits.listed)
  return rows.flatMap((row) =>
    Blocks.parse(row.blocks)
      .filter((block) => matches(block, query))
      .map((block) => ({ messageId: messageKey(row.id), threadId: threadKeyOf(row), who: row.who, at: row.createdAt.toISOString(), block })),
  )
}
