export type Tick = () => Promise<void>

export interface Scheduler {
  start: (tick: Tick) => () => void
}
