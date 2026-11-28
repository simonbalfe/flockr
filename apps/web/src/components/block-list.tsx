import type { Block } from "@flockr/client"
import type { ReactNode } from "react"

const mono = "font-mono text-[12.5px]"
const short = (sha: string | null) => (sha ? sha.slice(0, 7) : null)

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

function BlockBody({ block }: { block: Block }) {
  switch (block.kind) {
    case "approval":
      return (
        <Row label={block.verdict === "approved" ? "Approved" : "Changes"}>
          #{block.task}
          {block.commit && <span className={mono}> at {short(block.commit)}</span>}
        </Row>
      )
    case "deliverable":
      return (
        <>
          <Row label="Delivered">{block.summary}</Row>
          {(block.commit || block.branch) && (
            <Row label="Where">
              <span className={mono}>{[block.branch, short(block.commit)].filter(Boolean).join(" at ")}</span>
            </Row>
          )}
          {block.url && (
            <Row label="Link">
              <a className="underline decoration-accent underline-offset-[3px]" href={block.url} target="_blank" rel="noreferrer">
                {block.url}
              </a>
            </Row>
          )}
        </>
      )
    case "decision":
      return (
        <>
          <Row label="Decided">{block.decision}</Row>
          {block.why && <Row label="Why">{block.why}</Row>}
        </>
      )
    case "handoff":
      return (
        <>
          <Row label="Hand-off">
            #{block.task} from {block.from} to {block.to}
          </Row>
          {block.summary && <Row label="Summary">{block.summary}</Row>}
          <Row label="Branch">
            <span className={mono}>
              {block.branch}
              {block.commit ? ` at ${short(block.commit)}` : ""}
            </span>
          </Row>
          {block.files.length > 0 && (
            <Row label="Files">
              <span className={`${mono} break-all`}>{block.files.join(", ")}</span>
            </Row>
          )}
          {block.tests && <Row label="Tests">{block.tests}</Row>}
          {block.nextSteps.length > 0 && (
            <Row label="Next">
              <ol className="list-decimal pl-4">
                {block.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </Row>
          )}
        </>
      )
  }
}

export function BlockList({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) return null
  return (
    <div className="mt-1.5 grid max-w-[640px] gap-1.5">
      {blocks.map((block, i) => (
        <div key={`${block.kind}-${i}`} className="grid gap-0.5 border-l-2 border-border bg-muted px-3 py-2 text-[13px]" data-block={block.kind}>
          <BlockBody block={block} />
        </div>
      ))}
    </div>
  )
}
