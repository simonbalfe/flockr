import { ShieldQuestion } from "lucide-react"
import type { FormEvent, ReactNode } from "react"
import type { ApprovalAction, Question } from "@/api/types"
import { DiffView } from "@/components/agent/diff-view"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block"
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle } from "@/components/ai-elements/confirmation"
import { AlertDescription } from "@/components/ui/alert"
import { Questionnaire, QuestionnaireActions, QuestionnaireChoice, QuestionnaireChoices, QuestionnaireDescription, QuestionnaireItem, QuestionnaireTitle } from "@/components/ui/questionnaire"

interface PromptProps {
  question: Question
  pending: boolean
  onAnswer: (option: string) => void
  extra?: ReactNode
}

function ActionDetail({ action }: { action: ApprovalAction }) {
  const input = action.input && Object.keys(action.input).length ? JSON.stringify(action.input, null, 2) : null
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {action.command && (
        <CodeBlock size="sm" className="bg-background">
          <CodeBlockHeader>
            <CodeBlockTitle className="font-mono font-normal text-muted-foreground">{action.tool}</CodeBlockTitle>
          </CodeBlockHeader>
          <CodeBlockContent wrap>{`$ ${action.command}`}</CodeBlockContent>
        </CodeBlock>
      )}
      {input && (
        <CodeBlock size="sm" className="bg-background">
          {!action.command && (
            <CodeBlockHeader>
              <CodeBlockTitle className="font-mono font-normal text-muted-foreground">{action.tool}</CodeBlockTitle>
            </CodeBlockHeader>
          )}
          <CodeBlockContent wrap className="max-h-48">
            {input}
          </CodeBlockContent>
        </CodeBlock>
      )}
      {action.diff && <DiffView diff={action.diff} path={action.path} />}
      {!action.command && !input && !action.diff && <div className="font-mono text-xs text-muted-foreground">{action.path ? `${action.tool} ${action.path}` : action.tool}</div>}
    </div>
  )
}

function Buttons({ question, pending, onAnswer, extra }: PromptProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {question.options.map((option, i) => (
        <Button key={option} size="sm" variant={i === 0 ? "default" : "outline"} disabled={pending} onClick={() => onAnswer(option)}>
          {option}
        </Button>
      ))}
      {extra}
    </div>
  )
}

function ApprovalCard({ question, pending, onAnswer, extra, action }: PromptProps & { action: ApprovalAction }) {
  return (
    <Confirmation approval={{ id: question.text }} state="approval-requested" className="ai-elements-mono mt-1.5 max-w-[640px] gap-3 border-0 bg-muted px-3.5 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <ConfirmationTitle className="block font-semibold text-foreground">{question.text}</ConfirmationTitle>
          {question.detail && <AlertDescription className="mt-0.5 text-[13px]">{question.detail}</AlertDescription>}
        </div>
      </div>
      <ConfirmationRequest>
        <ActionDetail action={action} />
      </ConfirmationRequest>
      <ConfirmationActions className="flex-wrap justify-start self-start">
        {question.options.map((option, i) => (
          <ConfirmationAction key={option} variant={i === 0 ? "default" : "outline"} disabled={pending} onClick={() => onAnswer(option)}>
            {option}
          </ConfirmationAction>
        ))}
        {extra}
      </ConfirmationActions>
    </Confirmation>
  )
}

function Choices({ question, pending, onAnswer, extra }: PromptProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const picked = new FormData(event.currentTarget).get("answer")
    if (typeof picked === "string") onAnswer(picked)
  }
  return (
    <div className="mt-1.5 max-w-[640px] bg-muted px-3.5 pt-3 pb-3">
      <Questionnaire shortcuts="numbers" onSubmit={submit} items={[{ name: "answer", required: true, choices: question.options.map((value) => ({ value })) }]}>
        <QuestionnaireItem name="answer" required className="gap-3">
          <div>
            <QuestionnaireTitle className="mb-0 text-sm font-semibold">{question.text}</QuestionnaireTitle>
            {question.detail && <QuestionnaireDescription className="mt-0.5 text-[13px]">{question.detail}</QuestionnaireDescription>}
          </div>
          <QuestionnaireChoices>
            {question.options.map((option) => (
              <QuestionnaireChoice key={option} value={option} disabled={pending} onChange={() => onAnswer(option)} className="min-h-10 bg-background py-2 dark:bg-background">
                {option}
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
        </QuestionnaireItem>
        {extra && <QuestionnaireActions className="flex flex-wrap justify-start">{extra}</QuestionnaireActions>}
      </Questionnaire>
    </div>
  )
}

export function QuestionPrompt(props: PromptProps) {
  const { question } = props
  if (question.action) return <ApprovalCard {...props} action={question.action} />
  if (question.options.length > 2) return <Choices {...props} />
  return (
    <div className="mt-1.5 max-w-[640px] bg-muted px-3.5 pt-[13px] pb-3">
      <div className="font-semibold">{question.text}</div>
      {question.detail && <div className="mt-[3px] text-[13px] text-muted-foreground">{question.detail}</div>}
      <div className="mt-3">
        <Buttons {...props} />
      </div>
    </div>
  )
}
