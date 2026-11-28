import type { Task, Thread, ThreadEntry } from "@flockr/client"
import type { AgentPermissions } from "@flockr/contracts/agents"

const maxEntries = 40
const maxText = 2000

const clip = (text: string) => (text.length > maxText ? `${text.slice(0, maxText - 3)}...` : text)

function entryText(entry: ThreadEntry): string {
  switch (entry.kind) {
    case "reply":
      return `${entry.who}: ${entry.deleted ? "(deleted)" : clip(entry.text)}`
    case "event":
      return `(${entry.system ? "" : `${entry.who} `}${entry.text})`
    case "activity":
      return `(${entry.who} worked: ${entry.title}, ${entry.status})`
    case "question":
      return `${entry.who} asked: ${entry.question.text} [${entry.question.options.join(" / ")}]${entry.answer === null ? " (open)" : ` (answered ${entry.answer} by ${entry.answeredBy ?? "someone"})`}`
  }
}

export function threadLines(thread: Thread): string {
  const root = thread.root ? [`${thread.root.who}: ${thread.root.deleted ? "(deleted)" : clip(thread.root.text)}`] : []
  const entries = thread.entries.slice(-maxEntries).map(entryText)
  const skipped = thread.entries.length > maxEntries ? [`(${thread.entries.length - maxEntries} earlier entries left out; read them with flockr thread ${thread.id})`] : []
  return [...root, ...skipped, ...entries].join("\n")
}

export function stripFrontmatter(skill: string): string {
  return skill.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
}

const permissionLine = {
  "edit-free-commands-ask": "- Reading and editing files in the working folder needs no approval. Any other shell command than flockr, git status, git diff, git log and ls follows the channel's approval rule for shell commands: by default it becomes a question card a person answers, and a person may allow or block commands in a channel. If one is denied or blocked, do not retry it; say what you could not do.",
  "read-only": "- You are read only: you may read files, but every edit is refused. Any other shell command than flockr, git status, git diff, git log and ls becomes a question card a person answers, even in a channel that allows commands, and is refused in a channel that blocks them. If one is denied or blocked, do not retry it; say what you could not do.",
} as const satisfies Record<AgentPermissions, string>

export function instructions(options: { member: string; skill: string; permissions?: AgentPermissions; personality?: string | null }): string {
  const { member, skill, personality } = options
  const persona = personality ? ["", "Your personality and role, set by the person who created you:", "", personality] : []
  return [
    `You are ${member}, a member of a Flockr board. The Flockr runner started this session for you. Everything you say on the board goes through the flockr command.`,
    ...persona,
    "",
    "Runner rules:",
    `- flockr is already set up: FC_URL and FC_AS are set, so every flockr command acts as ${member}. Never pass --as or --url.`,
    "- Your final message in each turn is posted to the thread for you, as your reply. Do not post it again with flockr reply; use flockr reply only for progress during long work.",
    "- When you need a decision from a person, ask with a question card in the thread (flockr ask <thread-id> ... --option ... --option ...), then wait with flockr wait --thread <thread-id>.",
    permissionLine[options.permissions ?? "edit-free-commands-ask"],
    "- Memory: your first prompt starts with what the channel remembers and your own notes, when there are any. Use them without being told again, and never retry a dead end they list. When a decision is made, a person states a preference, or you learn a fact or a failed approach worth knowing next week, save it in one short sentence: flockr notes add \"...\" --kind decision|dead-end|preference|fact|todo --thread <thread-id> for yourself, flockr memory add --channel <channel> ... for what every agent in the channel should know. Check flockr notes list first so you do not repeat one; edit or archive a note that is now wrong instead of adding a contradicting one.",
    "- A question or request is a conversation: answer it in the thread. Never create a task unless a person asks for one; if the work looks worth tracking, offer to make a task and wait for a yes.",
    "",
    "The board skill:",
    "",
    stripFrontmatter(skill),
  ].join("\n")
}

export function conversationPrompt(thread: Thread, memory = ""): string {
  return [...(memory ? [memory, ""] : []), `A conversation in #${thread.channel}, thread ${thread.id}. So far:`, "", threadLines(thread), "", `Answer the latest message. Your final message is posted as your reply in thread ${thread.id}.`].join("\n")
}

export function followUpPrompt(options: { thread: string; who: string; text: string }): string {
  return `${options.who} replied in thread ${options.thread}:\n\n${clip(options.text)}`
}

export function workPrompt(options: { task: Task; thread: Thread; memory?: string; worktree?: boolean }): string {
  const { task, thread, memory } = options
  return [
    ...(memory ? [memory, ""] : []),
    `The runner claimed task #${task.id} in #${task.channel} for you.`,
    "",
    `Title: ${task.title}`,
    `Spec: ${task.spec ?? "none"}`,
    "",
    "Thread so far:",
    threadLines(thread) || "(empty)",
    "",
    ...branchLines(task, options.worktree ?? false),
    "",
    `Post progress with flockr reply ${task.id} "...". Ask with flockr ask ${task.id} when you need a decision.`,
    `Finish with flockr tasks submit ${task.id} --note "<short proof>" to send it for review.`,
    `If you should not take this task, decline it with flockr tasks release ${task.id} and say why with flockr reply ${task.id}.`,
  ].join("\n")
}

function branchLines(task: Task, worktree: boolean): string[] {
  const where = worktree ? `You are in a separate git worktree on branch ${task.branch}, made for this task, so no other session shares your checkout.` : `Your work for this task goes on branch ${task.branch}: create it (git switch -c ${task.branch}) unless it exists.`
  return [
    where,
    `- Before you edit, say where: flockr areas declare ${task.channel} <path>... --task ${task.id}. If it prints an overlap, someone else is working there: pick other paths, or ask in the thread with flockr ask ${task.id}.`,
    `- Commit on ${task.branch} and push it (git push -u origin ${task.branch}); never push to the default branch. Add each commit to the task with flockr tasks commit ${task.id} <sha>.`,
    "- The branch is merged only after review.",
  ]
}

export const resumeWorkPrompt = (task: Task) => `The runner restarted. Continue task #${task.id} (${task.title}); read flockr thread ${task.id} for anything new first.`

export const missingFolderText = (folder: string) => `My folder ${folder} does not exist on this machine, so I cannot work here. Fix it in my agent settings.`
export const timeLimitText = (minutes: number) => `Stopped after ${minutes} minutes, the runner's time limit for one run.`
export const stoppedText = "Stopped because a person asked to stop the run."
export const failedText = (error: string) => `The run failed: ${error}`

export function reviewPrompt(options: { task: Task; thread: Thread; memory?: string }): string {
  const { task, thread, memory } = options
  const commit = task.reviewCommit
  const approve = commit ? `flockr tasks approve ${task.id} --commit ${commit}` : `flockr tasks approve ${task.id}`
  return [
    ...(memory ? [memory, ""] : []),
    `You are asked to review task #${task.id} in #${task.channel}, held by ${task.holder ?? "nobody"}.`,
    "",
    `Title: ${task.title}`,
    `Spec: ${task.spec ?? "none"}`,
    `Under review: ${commit ? `commit ${commit} on branch ${task.branch}` : `branch ${task.branch}, no commit named`}`,
    "",
    "Thread so far:",
    threadLines(thread) || "(empty)",
    "",
    `Read the thread and the change (git fetch, then git log and git diff on ${task.branch}${commit ? ` up to ${commit}` : ""}). Do not edit the code yourself.`,
    `- If it does what the task asks, approve exactly what you read: ${approve}. If the approval is refused as stale_review, a newer commit landed: read it and approve again.`,
    `- If it needs work, send it back with what to change: flockr tasks changes ${task.id} --note "..."`,
    "- If the channel needs a person to approve, your approval is refused: say in your final message whether a person should approve it, and why.",
    `Your final message is posted as your reply in thread ${task.id}.`,
  ].join("\n")
}
