import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface PaneHandleProps {
  edge: "left" | "right"
  width: number
  label: string
  onResize: (width: number) => void
  onReset: () => void
  onDragging?: (dragging: boolean) => void
}

export function PaneHandle({ edge, width, label, onResize, onReset, onDragging }: PaneHandleProps) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const toggle = (next: boolean) => {
    setDragging(next)
    onDragging?.(next)
    document.body.style.cursor = next ? "col-resize" : ""
    document.body.style.userSelect = next ? "none" : ""
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        start.current = { x: event.clientX, width }
        toggle(true)
      }}
      onPointerMove={(event) => {
        if (!start.current) return
        const moved = event.clientX - start.current.x
        onResize(edge === "right" ? start.current.width + moved : start.current.width - moved)
      }}
      onPointerUp={() => {
        start.current = null
        toggle(false)
      }}
      onPointerCancel={() => {
        start.current = null
        toggle(false)
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10
        if (event.key === "ArrowLeft") onResize(edge === "right" ? width - step : width + step)
        if (event.key === "ArrowRight") onResize(edge === "right" ? width + step : width - step)
      }}
      className={cn(
        "absolute inset-y-0 z-10 hidden w-1.5 cursor-col-resize touch-none outline-none nav:block",
        edge === "right" ? "-right-[3px]" : "-left-[3px]",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring",
        dragging && "after:bg-ring",
      )}
    />
  )
}
