import { diffLines } from "@flockr/client"
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block"

const lineVariant = { hunk: "default", added: "added", removed: "removed", context: "default" } as const satisfies Record<
  ReturnType<typeof diffLines>[number]["kind"],
  "added" | "removed" | "default"
>

export function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
      <span className="text-foreground">+{added}</span> −{removed}
    </span>
  )
}

export function DiffView({ diff, path }: { diff: string; path?: string }) {
  return (
    <CodeBlock size="sm" className="bg-background">
      {path && (
        <CodeBlockHeader>
          <CodeBlockTitle className="font-mono font-normal">{path}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={diff} />
          </CodeBlockActions>
        </CodeBlockHeader>
      )}
      <CodeBlockContent className="max-h-80">
        {diffLines(diff).map((line, i) => (
          <CodeBlockLine key={i} variant={lineVariant[line.kind]} className={line.kind === "hunk" ? "text-muted-foreground" : "pl-6"}>
            {line.text}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}
