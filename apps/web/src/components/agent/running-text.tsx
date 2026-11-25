import { useReducedMotion } from "motion/react"
import { Shimmer } from "@/components/ai-elements/shimmer"

export function RunningText({ text, running, className }: { text: string; running: boolean; className?: string }) {
  const reduced = useReducedMotion()
  if (!running || reduced) return <span className={className}>{text}</span>
  return (
    <Shimmer as="span" className={className}>
      {text}
    </Shimmer>
  )
}
