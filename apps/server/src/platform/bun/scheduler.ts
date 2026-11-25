import type { Scheduler } from "../scheduler"

export function timerScheduler(everyMs: number): Scheduler {
  return {
    start(tick) {
      let running = false
      const timer = setInterval(() => {
        if (running) return
        running = true
        tick()
          .catch((error: unknown) => console.error("scheduled tick failed", error))
          .finally(() => {
            running = false
          })
      }, everyMs)
      return () => clearInterval(timer)
    },
  }
}
