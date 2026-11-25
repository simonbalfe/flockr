import { Children, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remend from "remend"
import { RichText } from "@/components/rich-text"
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block"
import { cn } from "@/lib/utils"

const linked = (children: ReactNode) => Children.map(children, (child) => (typeof child === "string" ? <RichText text={child} /> : child))

const textOf = (children: ReactNode): string =>
  Children.toArray(children)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
    .join("")

const components: Components = {
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{linked(children)}</p>,
  li: ({ children }) => <li className="my-0.5 pl-0.5">{linked(children)}</li>,
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  h1: ({ children }) => <p className="mt-3 mb-1 font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mt-3 mb-1 font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mt-2 mb-1 font-semibold first:mt-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{linked(children)}</strong>,
  em: ({ children }) => <em>{linked(children)}</em>,
  blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-3" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-foreground underline decoration-accent underline-offset-[3px] hover:decoration-foreground">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-muted px-2.5 py-1.5 text-left font-medium">{linked(children)}</th>,
  td: ({ children }) => <td className="border-b px-2.5 py-1.5 align-top [tr:last-child_&]:border-b-0">{linked(children)}</td>,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const language = /language-(\S+)/.exec(className ?? "")?.[1]
    const text = textOf(children)
    if (!language && !text.includes("\n")) return <code className="rounded bg-muted px-1 py-px font-mono text-[12.5px]">{children}</code>
    return (
      <CodeBlock size="sm" className="my-2">
        {language && (
          <CodeBlockHeader>
            <CodeBlockTitle className="font-mono font-normal text-muted-foreground">{language}</CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton value={text} />
            </CodeBlockActions>
          </CodeBlockHeader>
        )}
        <CodeBlockContent className="max-h-80">{text.replace(/\n$/, "")}</CodeBlockContent>
      </CodeBlock>
    )
  },
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("min-w-0 [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {remend(text)}
      </ReactMarkdown>
    </div>
  )
}
