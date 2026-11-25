import { partHeadline } from "@flockr/client"
import { Bot, Brain, ChevronRight, File, FileDiff, FlaskConical, Folder, ListChecks, SquareTerminal, TriangleAlert, Wrench, type LucideIcon } from "lucide-react"
import { useState, type ReactNode } from "react"
import type { ActivityPart, FileChange, PlanStep } from "@/api/types"
import { DiffStat, DiffView } from "@/components/agent/diff-view"
import { Markdown } from "@/components/agent/markdown"
import { StatusGlyph, StepGlyph } from "@/components/agent/status-glyph"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { useClock } from "@/components/agent/use-clock"
import { duration, partDuration } from "@/lib/work"
import { cn } from "@/lib/utils"

const partIcon = {
  tool: Wrench,
  terminal: SquareTerminal,
  reasoning: Brain,
  plan: ListChecks,
  files: FileDiff,
  tests: FlaskConical,
  subagent: Bot,
  error: TriangleAlert,
} as const satisfies Record<ActivityPart["type"], LucideIcon>

type LineStatus = "running" | "error" | undefined

function lineStatus(part: ActivityPart): LineStatus {
  if (!("status" in part)) return part.type === "error" ? "error" : undefined
  if (part.status === "running") return "running"
  return part.status === "error" ? "error" : undefined
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mt-2 mb-1 text-xs font-medium text-muted-foreground first:mt-0">{children}</div>
}

function Output({ text, empty }: { text: string; empty: string }) {
  return (
    <CodeBlock size="sm" className="bg-background">
      <CodeBlockContent wrap className="max-h-64">
        {text || empty}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function PartLine({ part, title }: { part: ActivityPart; title?: string }) {
  const now = useClock(lineStatus(part) === "running")
  const Icon = partIcon[part.type]
  const ms = partDuration(part, now)
  return (
    <TraceLine status={lineStatus(part)}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle>{title ?? partHeadline(part)}</TraceTitle>
      {"status" in part && part.status !== "running" && <StatusGlyph status={part.status} className="text-muted-foreground" />}
      {ms !== null && <TraceDescription>{duration(ms)}</TraceDescription>}
    </TraceLine>
  )
}

function Expandable({ part, children, defaultOpen, title }: { part: ActivityPart; children: ReactNode; defaultOpen?: boolean; title?: string }) {
  const running = lineStatus(part) === "running"
  const [open, setOpen] = useState<boolean | undefined>(defaultOpen)
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <PartLine part={part} title={title} />
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

const pretty = (value: Record<string, unknown>) => JSON.stringify(value, null, 2)

export function PlanSteps({ steps }: { steps: PlanStep[] }) {
  const done = steps.filter((s) => s.status === "done")
  const open = steps.filter((s) => s.status !== "done")
  return (
    <Trace className="gap-1.5">
      {open.map((step, i) => (
        <TraceLine key={`${i}:${step.text}`} status={step.status === "doing" ? "running" : "pending"} className="text-foreground data-[status=pending]:text-muted-foreground data-[status=pending]:opacity-100">
          <StepGlyph status={step.status} />
          <TraceTitle className="whitespace-normal">{step.text}</TraceTitle>
        </TraceLine>
      ))}
      {done.length > 0 && (
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <StepGlyph status="done" />
              <TraceTitle>{done.length} completed</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="flex flex-col gap-1.5">
            {done.map((step, i) => (
              <span key={`${i}:${step.text}`} className="line-through decoration-muted-foreground/50">
                {step.text}
              </span>
            ))}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
    </Trace>
  )
}

type TreeNode = { kind: "folder"; name: string; path: string; children: TreeNode[] } | { kind: "file"; name: string; path: string; file: FileChange }

function buildTree(files: FileChange[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const file of files) {
    const segments = file.path.split("/")
    let level = root
    segments.forEach((name, i) => {
      const path = segments.slice(0, i + 1).join("/")
      if (i === segments.length - 1) {
        level.push({ kind: "file", name, path, file })
        return
      }
      const found = level.find((n): n is Extract<TreeNode, { kind: "folder" }> => n.kind === "folder" && n.name === name)
      const folder: Extract<TreeNode, { kind: "folder" }> = found ?? { kind: "folder", name, path, children: [] }
      if (!found) level.push(folder)
      level = folder.children
    })
  }
  return collapse(root)
}

function collapse(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "file") return node
    const children = collapse(node.children)
    const only = children[0]
    if (children.length === 1 && only?.kind === "folder") return { ...only, name: `${node.name}/${only.name}` }
    return { ...node, children }
  })
}

function TreeRow({ node, selected, onSelect }: { node: TreeNode; selected: string | null; onSelect: (path: string | null) => void }) {
  switch (node.kind) {
    case "folder":
      return (
        <Collapsible defaultOpen className="group/folder">
          <CollapsibleTrigger className="flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]/folder:rotate-90" />
            <Folder className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate font-mono text-xs">{node.name}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="ml-3.5 flex flex-col border-l pl-1.5">
              {node.children.map((child) => (
                <TreeRow key={child.path} node={child} selected={selected} onSelect={onSelect} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )
    case "file": {
      const active = selected === node.path
      return (
        <button
          type="button"
          aria-expanded={node.file.diff ? active : undefined}
          disabled={!node.file.diff}
          onClick={() => onSelect(active ? null : node.path)}
          className={cn(
            "flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-foreground enabled:hover:bg-muted disabled:cursor-default",
            active && "bg-muted",
          )}
        >
          <File className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{node.name}</span>
          <DiffStat added={node.file.added} removed={node.file.removed} />
        </button>
      )
    }
    default: {
      const unreachable: never = node
      return unreachable
    }
  }
}

export function FileTree({ files }: { files: FileChange[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const open = files.find((f) => f.path === selected)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col">
        {buildTree(files).map((node) => (
          <TreeRow key={node.path} node={node} selected={selected} onSelect={setSelected} />
        ))}
      </div>
      {open?.diff && <DiffView diff={open.diff} path={open.path} />}
    </div>
  )
}

export function PartRow({ part }: { part: ActivityPart }) {
  switch (part.type) {
    case "tool":
      return (
        <Expandable part={part}>
          {Object.keys(part.input).length > 0 && (
            <>
              <Label>Input</Label>
              <Output text={pretty(part.input)} empty="" />
            </>
          )}
          <Label>Output</Label>
          <Output text={part.output} empty={part.status === "running" ? "Waiting for output..." : "No output"} />
        </Expandable>
      )
    case "terminal":
      return (
        <Expandable part={part} title={`$ ${part.command}`} defaultOpen={part.status === "error" ? true : undefined}>
          <Output text={part.output} empty={part.status === "running" ? "Waiting for output..." : "No output"} />
          {part.exitCode !== null && <div className="mt-1.5 text-xs text-muted-foreground tabular-nums">Exit code {part.exitCode}</div>}
        </Expandable>
      )
    case "reasoning":
      return (
        <Expandable part={part}>
          <Markdown text={part.text} className="text-[13px]" />
        </Expandable>
      )
    case "plan":
      return (
        <Expandable part={part} defaultOpen>
          <PlanSteps steps={part.steps} />
        </Expandable>
      )
    case "files":
      return (
        <Expandable part={part} defaultOpen>
          <FileTree files={part.files} />
        </Expandable>
      )
    case "tests":
      return (
        <Expandable part={part} defaultOpen={part.failed > 0 ? true : undefined}>
          {part.command && <div className="mb-1.5 font-mono text-xs">$ {part.command}</div>}
          {part.suites.length > 0 && (
            <div className="mb-2 flex flex-col gap-1">
              {part.suites.map((suite) => (
                <div key={suite.name} className="flex items-center gap-2 text-[13px]">
                  <StatusGlyph status={suite.failed ? "error" : "ok"} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{suite.name}</span>
                  <span className="text-xs tabular-nums">
                    {suite.passed} passed{suite.failed ? `, ${suite.failed} failed` : ""}
                    {suite.skipped ? `, ${suite.skipped} skipped` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          {part.failures.map((failure) => (
            <div key={failure.name} className="mb-2">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                <StatusGlyph status="error" />
                <span className="min-w-0 truncate">{failure.name}</span>
              </div>
              {failure.location && <div className="ml-5 font-mono text-xs">{failure.location}</div>}
              {failure.message && (
                <div className="mt-1 ml-5">
                  <Output text={failure.message} empty="" />
                </div>
              )}
            </div>
          ))}
          {part.skipped > 0 && <div className="text-xs tabular-nums">{part.skipped} skipped</div>}
        </Expandable>
      )
    case "subagent":
      return (
        <Expandable part={part}>
          <div className="mb-1 text-[13px] text-foreground">{part.task}</div>
          {part.summary ? <Markdown text={part.summary} className="text-[13px]" /> : <span className="text-[13px]">Working...</span>}
        </Expandable>
      )
    case "error":
      return (
        <Expandable part={part} defaultOpen>
          {part.frames.length ? (
            <ol className="flex flex-col gap-1 overflow-x-auto rounded-md bg-background p-3 font-mono text-xs">
              {part.frames.map((frame, i) => (
                <li key={`${i}:${frame.file}:${frame.line}`} className={cn("whitespace-nowrap", i === 0 ? "text-foreground" : "text-muted-foreground")}>
                  at {frame.function ? `${frame.function} ` : ""}
                  <span className={cn(i === 0 && "underline decoration-muted-foreground/50 underline-offset-2")}>
                    {frame.file}
                    {frame.line !== null ? `:${frame.line}` : ""}
                    {frame.column !== null ? `:${frame.column}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="text-[13px]">No stack frames</span>
          )}
        </Expandable>
      )
    default: {
      const unreachable: never = part
      return unreachable
    }
  }
}
