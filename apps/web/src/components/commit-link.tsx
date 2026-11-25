import { createContext, useContext, type ReactNode } from "react"
import type { TaskCommit } from "@/api/types"

const CommitLinks = createContext<ReadonlyMap<string, string>>(new Map())

export function CommitLinksProvider({ commits, children }: { commits: TaskCommit[]; children: ReactNode }) {
  const links = new Map<string, string>()
  for (const commit of commits) {
    if (!commit.url) continue
    links.set(commit.short, commit.url)
    links.set(commit.sha, commit.url)
  }
  return <CommitLinks.Provider value={links}>{children}</CommitLinks.Provider>
}

const codeClass = " bg-muted px-1 py-px font-mono text-[12.5px]"
const linkClass = "underline decoration-accent underline-offset-[3px] hover:decoration-foreground"

function ShaLink({ url, title, children }: { url: string; title?: string; children: ReactNode }) {
  return (
    <a href={url} title={title} target="_blank" rel="noreferrer noopener" className={`${codeClass} text-foreground ${linkClass}`}>
      {children}
    </a>
  )
}

export function InlineCode({ text, children }: { text: string; children?: ReactNode }) {
  const url = useContext(CommitLinks).get(text.toLowerCase())
  if (url) return <ShaLink url={url}>{children ?? text}</ShaLink>
  return <code className={codeClass}>{children ?? text}</code>
}

export function CommitSha({ commit }: { commit: TaskCommit }) {
  const title = commit.message ?? commit.sha
  if (commit.url) return <ShaLink url={commit.url} title={title}>{commit.short}</ShaLink>
  return (
    <code title={title} className={codeClass}>
      {commit.short}
    </code>
  )
}
