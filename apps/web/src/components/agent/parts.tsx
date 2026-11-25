import { partHeadline } from "@flockr/client"
import { Bot, ChevronRight, File, FileDiff, FlaskConical, ListChecks, type LucideIcon } from "lucide-react"
import { useState, type ComponentProps, type ReactNode } from "react"
import type { ActivityPart, FileChange, PlanStep } from "@/api/types"
import { FileTree, FileTreeActions, FileTreeFile, FileTreeFolder, FileTreeIcon, FileTreeName } from "@/components/ai-elements/file-tree"
import { Plan, PlanAction, PlanContent, PlanHeader, PlanTitle, PlanTrigger } from "@/components/ai-elements/plan"
import { QueueItem, QueueItemContent, QueueItemIndicator, QueueSection, QueueSectionContent, QueueSectionLabel, QueueSectionTrigger } from "@/components/ai-elements/queue"
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning"
import {
  StackTrace,
  StackTraceActions,
  StackTraceContent,
  StackTraceCopyButton,
  StackTraceError,
  StackTraceErrorMessage,
  StackTraceErrorType,
  StackTraceExpandButton,
  StackTraceFrames,
  StackTraceHeader,
} from "@/components/ai-elements/stack-trace"
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task"
import { Terminal, TerminalActions, TerminalContent, TerminalCopyButton, TerminalHeader, TerminalStatus, TerminalTitle } from "@/components/ai-elements/terminal"
import {
  Test,
  TestError,
  TestErrorMessage,
  TestErrorStack,
  TestName,
  TestResults,
  TestResultsContent,
  TestResultsDuration,
  TestResultsHeader,
  TestResultsSummary,
  TestStatus,
  TestSuiteStats,
} from "@/components/ai-elements/test-results"
import { getStatusBadge, Tool, ToolContent, ToolHeader, type ToolPart } from "@/components/ai-elements/tool"
import { DiffStat, DiffView } from "@/components/agent/diff-view"
import { Markdown } from "@/components/agent/markdown"
import { RunningText } from "@/components/agent/running-text"
import { useClock } from "@/components/agent/use-clock"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import { duration, partDuration } from "@/lib/work"
import { cn } from "@/lib/utils"

type TimedPart = Extract<ActivityPart, { status: unknown }>

const toolState = { running: "input-available", ok: "output-available", error: "output-error" } as const satisfies Record<TimedPart["status"], ToolPart["state"]>

const lineText = "text-sm text-muted-foreground transition-colors hover:text-foreground"
const body = "mt-1.5 ml-[7px] border-l-2 border-muted pl-4"
const taskBody = "[&>div]:mt-1.5 [&>div]:ml-[7px] [&>div]:pl-4"

const ansiCodes = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g")

const isRunning = (part: ActivityPart) => "status" in part && part.status === "running"

function useOpen(defaultOpen: boolean | undefined, running: boolean) {
  const [open, setOpen] = useState<boolean | undefined>(defaultOpen)
  return { open: open ?? running, onOpenChange: setOpen }
}

function useElapsed(part: ActivityPart) {
  const now = useClock(isRunning(part))
  const ms = partDuration(part, now)
  return ms === null ? "" : duration(ms)
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

type LineProps = Omit<ComponentProps<"button">, "title"> & { step: ActivityPart; icon: LucideIcon }

function Line({ step: part, icon: Icon, className, ...props }: LineProps) {
  const elapsed = useElapsed(part)
  return (
    <button type="button" className={cn("flex w-fit max-w-full min-w-0 items-center gap-2 text-left", lineText, className)} {...props}>
      <Icon className="size-4 shrink-0" />
      <RunningText text={partHeadline(part)} running={isRunning(part)} className="min-w-0 truncate" />
      {"status" in part && getStatusBadge(toolState[part.status])}
      {elapsed && <span className="shrink-0 text-xs tabular-nums">{elapsed}</span>}
      <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
    </button>
  )
}

function TaskPart({ part, icon, defaultOpen, children }: { part: ActivityPart; icon: LucideIcon; defaultOpen?: boolean; children: ReactNode }) {
  const state = useOpen(defaultOpen, isRunning(part))
  return (
    <Task {...state}>
      <TaskTrigger title={partHeadline(part)}>
        <Line step={part} icon={icon} />
      </TaskTrigger>
      <TaskContent className={taskBody}>{children}</TaskContent>
    </Task>
  )
}

function ToolLine({ part, title, defaultOpen, children }: { part: TimedPart; title: string; defaultOpen?: boolean; children: ReactNode }) {
  const state = useOpen(defaultOpen, part.status === "running")
  const elapsed = useElapsed(part)
  return (
    <Tool {...state} className="mb-0 border-0">
      <ToolHeader
        type="dynamic-tool"
        toolName={title}
        title={elapsed ? `${title} · ${elapsed}` : title}
        state={toolState[part.status]}
        className={cn("w-fit max-w-full justify-start gap-2 p-0 text-left [&_span]:font-normal [&>div]:min-w-0 [&>div>span]:min-w-0 [&>div>span]:truncate [&_svg]:shrink-0", lineText)}
      />
      <ToolContent className={cn(body, "space-y-0 p-0 pl-4")}>{children}</ToolContent>
    </Tool>
  )
}

function TerminalOutput({ output, running }: { output: string; running: boolean }) {
  const clean = output.replace(ansiCodes, "")
  return (
    <Terminal output={clean} isStreaming={running}>
      <TerminalHeader className="px-3 py-1">
        <TerminalTitle className="text-xs">Output</TerminalTitle>
        <TerminalActions>
          <TerminalStatus>
            <RunningText text="Streaming" running />
          </TerminalStatus>
          <TerminalCopyButton aria-label="Copy output" />
        </TerminalActions>
      </TerminalHeader>
      <TerminalContent className="max-h-64 p-3 text-xs">
        <pre className={cn("font-mono break-words whitespace-pre-wrap", !clean && "text-muted-foreground")}>{clean || (running ? "Waiting for output..." : "No output")}</pre>
      </TerminalContent>
    </Terminal>
  )
}

export function PlanSteps({ steps }: { steps: PlanStep[] }) {
  const done = steps.filter((s) => s.status === "done")
  const open = steps.filter((s) => s.status !== "done")
  return (
    <div className="flex flex-col gap-0.5">
      <ul className="flex flex-col">
        {open.map((step, i) => (
          <QueueItem key={`${i}:${step.text}`} className="px-0 py-0.5 hover:bg-transparent">
            <div className="flex items-start gap-2">
              <QueueItemIndicator className={cn("mt-1 shrink-0", step.status === "doing" && "border-foreground bg-foreground")} aria-label={step.status === "doing" ? "Doing" : "To do"} role="img" />
              <QueueItemContent className={cn("line-clamp-none", step.status === "doing" && "text-foreground")}>
                <RunningText text={step.text} running={step.status === "doing"} />
              </QueueItemContent>
            </div>
          </QueueItem>
        ))}
      </ul>
      {done.length > 0 && (
        <QueueSection defaultOpen={false}>
          <QueueSectionTrigger className="w-fit bg-transparent px-0 py-0.5 font-normal hover:bg-transparent hover:text-foreground">
            <QueueSectionLabel count={done.length} label="completed" className="[&>svg]:size-3.5" />
          </QueueSectionTrigger>
          <QueueSectionContent>
            <ul className="flex flex-col">
              {done.map((step, i) => (
                <QueueItem key={`${i}:${step.text}`} className="px-0 py-0.5 hover:bg-transparent">
                  <div className="flex items-start gap-2">
                    <QueueItemIndicator completed className="mt-1 shrink-0" aria-label="Done" role="img" />
                    <QueueItemContent completed className="line-clamp-none">
                      {step.text}
                    </QueueItemContent>
                  </div>
                </QueueItem>
              ))}
            </ul>
          </QueueSectionContent>
        </QueueSection>
      )}
    </div>
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

const folderPaths = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.kind === "folder" ? [n.path, ...folderPaths(n.children)] : []))

function TreeRow({ node }: { node: TreeNode }) {
  switch (node.kind) {
    case "folder":
      return (
        <FileTreeFolder path={node.path} name={node.name}>
          {node.children.map((child) => (
            <TreeRow key={child.path} node={child} />
          ))}
        </FileTreeFolder>
      )
    case "file":
      return (
        <FileTreeFile path={node.path} name={node.name} aria-disabled={!node.file.diff} className={cn("text-foreground", !node.file.diff && "cursor-default")}>
          <span className="size-4 shrink-0" />
          <FileTreeIcon>
            <File className="size-4 text-muted-foreground" />
          </FileTreeIcon>
          <FileTreeName className="min-w-0 flex-1 text-xs">{node.name}</FileTreeName>
          <FileTreeActions>
            <DiffStat added={node.file.added} removed={node.file.removed} />
          </FileTreeActions>
        </FileTreeFile>
      )
    default: {
      const unreachable: never = node
      return unreachable
    }
  }
}

export function ChangedFiles({ files }: { files: FileChange[] }) {
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const tree = buildTree(files)
  const open = files.find((f) => f.path === selected)
  const select = (path: string) => {
    const file = files.find((f) => f.path === path)
    if (!file?.diff) return
    setSelected(selected === path ? undefined : path)
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FileTree defaultExpanded={new Set(folderPaths(tree))} selectedPath={selected} onSelect={select} className="border-0 bg-transparent text-xs [&>div]:p-0">
        {tree.map((node) => (
          <TreeRow key={node.path} node={node} />
        ))}
      </FileTree>
      {open?.diff && <DiffView diff={open.diff} path={open.path} />}
    </div>
  )
}

function stackText(part: Extract<ActivityPart, { type: "error" }>): string {
  const frames = part.frames.map((f) => {
    const where = [f.file, f.line, f.column].filter((v) => v !== null).join(":")
    return f.function ? `    at ${f.function} (${where})` : `    at ${where}`
  })
  return [`${part.name ?? "Error"}: ${part.message}`, ...frames].join("\n")
}

export function PartRow({ part }: { part: ActivityPart }) {
  switch (part.type) {
    case "tool":
      return (
        <ToolLine part={part} title={partHeadline(part)}>
          {Object.keys(part.input).length > 0 && (
            <>
              <Label>Input</Label>
              <Output text={JSON.stringify(part.input, null, 2)} empty="" />
            </>
          )}
          <Label>Output</Label>
          <Output text={part.output} empty={part.status === "running" ? "Waiting for output..." : "No output"} />
        </ToolLine>
      )
    case "terminal":
      return (
        <ToolLine part={part} title={`$ ${part.command}`} defaultOpen={part.status === "error" ? true : undefined}>
          <TerminalOutput output={part.output} running={part.status === "running"} />
          {part.exitCode !== null && <div className="mt-1.5 text-xs text-muted-foreground tabular-nums">Exit code {part.exitCode}</div>}
        </ToolLine>
      )
    case "reasoning":
      return (
        <Reasoning isStreaming={part.status === "running"} duration={part.durationMs ? Math.max(1, Math.ceil(part.durationMs / 1000)) : undefined} className="mb-0">
          <ReasoningTrigger className="w-fit max-w-full text-left" />
          <ReasoningContent className={cn(body, "text-[13px] text-muted-foreground")}>
            <Markdown text={part.text} className="text-[13px]" />
          </ReasoningContent>
        </Reasoning>
      )
    case "plan": {
      const doing = part.steps.some((s) => s.status === "doing")
      return (
        <Plan isStreaming={doing} defaultOpen className="gap-0 overflow-visible bg-transparent py-0 ring-0">
          <PlanHeader className="flex items-center justify-start gap-2 px-0">
            <ListChecks className="size-4 shrink-0 text-muted-foreground" />
            <PlanTitle className="min-w-0 truncate text-sm font-normal text-muted-foreground">{partHeadline(part)}</PlanTitle>
            <PlanAction className="self-center">
              <PlanTrigger className="size-6 text-muted-foreground" />
            </PlanAction>
          </PlanHeader>
          <PlanContent className={cn(body, "px-0 pl-4")}>
            <PlanSteps steps={part.steps} />
          </PlanContent>
        </Plan>
      )
    }
    case "files":
      return (
        <TaskPart part={part} icon={FileDiff} defaultOpen>
          <ChangedFiles files={part.files} />
        </TaskPart>
      )
    case "tests":
      return (
        <TaskPart part={part} icon={FlaskConical} defaultOpen={part.failed > 0 ? true : undefined}>
          <TestResults
            summary={{ passed: part.passed, failed: part.failed, skipped: part.skipped, total: part.passed + part.failed + part.skipped, duration: part.durationMs ?? undefined }}
           
          >
            <TestResultsHeader className="flex-wrap gap-2 px-3 py-2">
              <TestResultsSummary className="flex-wrap gap-1.5" />
              <TestResultsDuration className="text-xs tabular-nums" />
            </TestResultsHeader>
            {(part.command || part.suites.length > 0 || part.failures.length > 0) && (
              <TestResultsContent className="space-y-1 p-0 py-1">
                {part.command && <div className="px-3 py-1 font-mono text-xs text-muted-foreground">$ {part.command}</div>}
                {part.suites.map((suite) => (
                  <Test key={suite.name} name={suite.name} status={suite.failed ? "failed" : "passed"} className="px-3 py-1">
                    <TestStatus />
                    <TestName className="min-w-0 truncate font-mono text-xs" />
                    <TestSuiteStats passed={suite.passed} failed={suite.failed} skipped={suite.skipped} className="shrink-0 tabular-nums" />
                  </Test>
                ))}
                {part.failures.map((failure) => (
                  <div key={failure.name} className="px-3 py-1">
                    <Test name={failure.name} status="failed" className="px-0 py-0 text-[13px] font-medium" />
                    <TestError className="mt-1 ml-6 p-2">
                      {failure.location && <TestErrorMessage className="font-mono text-xs font-normal">{failure.location}</TestErrorMessage>}
                      {failure.message && <TestErrorStack className="mt-1 whitespace-pre-wrap">{failure.message}</TestErrorStack>}
                    </TestError>
                  </div>
                ))}
              </TestResultsContent>
            )}
          </TestResults>
        </TaskPart>
      )
    case "subagent":
      return (
        <TaskPart part={part} icon={Bot}>
          <TaskItem className="text-[13px] text-foreground">{part.task}</TaskItem>
          <TaskItem className="text-[13px]">{part.summary ? <Markdown text={part.summary} className="text-[13px]" /> : "Working..."}</TaskItem>
        </TaskPart>
      )
    case "error":
      return (
        <StackTrace trace={stackText(part)} defaultOpen>
          <StackTraceHeader className="gap-2 px-3 py-2">
            <StackTraceError>
              {part.name && <StackTraceErrorType className="text-xs">{part.name}</StackTraceErrorType>}
              <StackTraceErrorMessage className="text-xs">{part.message}</StackTraceErrorMessage>
            </StackTraceError>
            <StackTraceActions>
              <StackTraceCopyButton aria-label="Copy stack" />
              <StackTraceExpandButton />
            </StackTraceActions>
          </StackTraceHeader>
          <StackTraceContent maxHeight={320}>
            <StackTraceFrames className="w-max min-w-full [&>div]:whitespace-nowrap" />
          </StackTraceContent>
        </StackTrace>
      )
    default: {
      const unreachable: never = part
      return unreachable
    }
  }
}
