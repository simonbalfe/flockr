import { useEffect, useRef } from "react"

export function useScrollToEnd(signal: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" })
  }, [signal])
  return ref
}
