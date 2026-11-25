export const cronFields = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
] as const

export const cronSearchDays = 366 * 5

export interface Cron {
  minutes: number[]
  hours: number[]
  days: ReadonlySet<number>
  months: ReadonlySet<number>
  weekdays: ReadonlySet<number>
  anyDay: boolean
  anyWeekday: boolean
}

export type CronParse = { ok: true; cron: Cron } | { ok: false; error: string }

type FieldParse = { ok: true; values: number[]; any: boolean } | { ok: false; error: string }

const wholeNumber = /^\d+$/

function parseField(text: string, field: (typeof cronFields)[number]): FieldParse {
  const values = new Set<number>()
  for (const part of text.split(",")) {
    const [range, stepText, extra] = part.split("/")
    if (range === undefined || range === "" || extra !== undefined) return { ok: false, error: `${field.name}: "${part}" is not a value, range or step` }
    let step = 1
    if (stepText !== undefined) {
      if (!wholeNumber.test(stepText) || Number(stepText) < 1) return { ok: false, error: `${field.name}: the step in "${part}" must be a whole number of 1 or more` }
      step = Number(stepText)
    }
    let low: number = field.min
    let high: number = field.max
    if (range !== "*") {
      const [from, to, more] = range.split("-")
      if (from === undefined || !wholeNumber.test(from) || more !== undefined || (to !== undefined && !wholeNumber.test(to))) {
        return { ok: false, error: `${field.name}: "${part}" is not a value, range or step` }
      }
      low = Number(from)
      high = to === undefined ? (stepText === undefined ? low : field.max) : Number(to)
      if (low < field.min || high > field.max) return { ok: false, error: `${field.name}: "${part}" is outside ${field.min}-${field.max}` }
      if (low > high) return { ok: false, error: `${field.name}: "${part}" runs backwards` }
    }
    for (let value = low; value <= high; value += step) values.add(value)
  }
  return { ok: true, values: [...values].sort((a, b) => a - b), any: text === "*" }
}

export function parseCron(expression: string): CronParse {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== cronFields.length) return { ok: false, error: `A schedule has 5 fields (minute hour day month weekday), got ${parts.length}` }
  const parsed: { values: number[]; any: boolean }[] = []
  for (const [i, field] of cronFields.entries()) {
    const result = parseField(parts[i] ?? "", field)
    if (!result.ok) return result
    parsed.push(result)
  }
  const [minutes, hours, days, months, weekdays] = parsed
  if (!minutes || !hours || !days || !months || !weekdays) return { ok: false, error: "A schedule has 5 fields" }
  const cron: Cron = {
    minutes: minutes.values,
    hours: hours.values,
    days: new Set(days.values),
    months: new Set(months.values),
    weekdays: new Set(weekdays.values.map((d) => d % 7)),
    anyDay: days.any,
    anyWeekday: weekdays.any,
  }
  if (nextCronTime(cron, new Date(Date.UTC(2000, 0, 1))) === null) return { ok: false, error: "This schedule never fires" }
  return { ok: true, cron }
}

function dayMatches(cron: Cron, day: Date): boolean {
  if (!cron.months.has(day.getUTCMonth() + 1)) return false
  const byDate = cron.days.has(day.getUTCDate())
  const byWeekday = cron.weekdays.has(day.getUTCDay())
  if (cron.anyDay && cron.anyWeekday) return true
  if (cron.anyDay) return byWeekday
  if (cron.anyWeekday) return byDate
  return byDate || byWeekday
}

export function nextCronTime(cron: Cron, after: Date): Date | null {
  const start = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000)
  const firstDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  for (let i = 0; i <= cronSearchDays; i++) {
    const day = new Date(firstDay + i * 86_400_000)
    if (!dayMatches(cron, day)) continue
    const sameDay = i === 0
    for (const hour of cron.hours) {
      if (sameDay && hour < start.getUTCHours()) continue
      for (const minute of cron.minutes) {
        if (sameDay && hour === start.getUTCHours() && minute < start.getUTCMinutes()) continue
        return new Date(day.getTime() + hour * 3_600_000 + minute * 60_000)
      }
    }
  }
  return null
}

export function nextRunOf(expression: string, after: Date): Date | null {
  const parsed = parseCron(expression)
  return parsed.ok ? nextCronTime(parsed.cron, after) : null
}
