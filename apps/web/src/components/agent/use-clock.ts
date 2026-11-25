import { useEffect, useState } from "react"
import { useNow } from "@/lib/now"

export function useClock(running: boolean): number {
  const slow = useNow()
  const [fast, setFast] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setFast(Date.now())
    const timer = window.setInterval(() => setFast(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return running ? fast : slow
}
