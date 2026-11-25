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
  "edit-free-commands-ask": "- Reading and editing files in the working folder needs no approval. Any other shell command than flockr, git status, git diff, git log and ls becomes a question card a person answers. If one is denied, do not retry it; say what you could not do.",
  "read-only": "- You are read only: you may read files, but every edit is refused. Any other shell command than flockr, git status, git diff, git log and ls becomes a question card a person answers. If one is denied, do not retry it; say what you could not do.",
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
    "- Conversation is the default. Create a task (flockr tasks create) only when someone asks for one or the work is worth tracking.",
    "",
    "The board skill:",
    "",
    stripFrontmatter(skill),
  ].join("\n")
}

export function conversationPrompt(thread: Thread): string {
  return [`A conversation in #${thread.channel}, thread ${thread.id}. So far:`, "", threadLines(thread), "", `Answer the latest message. Your final message is posted as your reply in thread ${thread.id}.`].join("\n")
}

export function followUpPrompt(options: { thread: string; who: string; text: string }): string {
  return `${options.who} replied in thread ${options.thread}:\n\n${clip(options.text)}`
}

export function workPrompt(options: { task: Task; thread: Thread }): string {
  const { task, thread } = options
  return [
    `The runner claimed task #${task.id} in #${task.channel} for you.`,
    "",
    `Title: ${task.title}`,
    `Spec: ${task.spec ?? "none"}`,
    "",
    "Thread so far:",
    threadLines(thread) || "(empty)",
    "",
    `Post progress with flockr reply ${task.id} "...". Ask with flockr ask ${task.id} when you need a decision.`,
    `Finish with flockr tasks submit ${task.id} --note "<short proof>" to send it for review.`,
    `If you should not take this task, decline it with flockr tasks release ${task.id} and say why with flockr reply ${task.id}.`,
  ].join("\n")
}

export const resumeWorkPrompt = (task: Task) => `The runner restarted. Continue task #${task.id} (${task.title}); read flockr thread ${task.id} for anything new first.`

export const missingFolderText = (folder: string) => `My folder ${folder} does not exist on this machine, so I cannot work here. Fix it in my agent settings.`
export const timeLimitText = (minutes: number) => `Stopped after ${minutes} minutes, the runner's time limit for one run.`
export const stoppedText = "Stopped because a person asked to stop the run."
export const failedText = (error: string) => `The run failed: ${error}`
