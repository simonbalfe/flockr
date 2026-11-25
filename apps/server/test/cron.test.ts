import { describe, expect, test } from "bun:test"
import { nextRunOf, parseCron } from "@flockr/contracts"

const after = "2026-11-25T10:17:30.000Z"

const next: [schedule: string, from: string, expected: string][] = [
  ["* * * * *", after, "2026-11-25T10:18:00.000Z"],
  ["*/15 * * * *", after, "2026-11-25T10:30:00.000Z"],
  ["0 * * * *", after, "2026-11-25T11:00:00.000Z"],
  ["0 8 * * *", after, "2026-11-26T08:00:00.000Z"],
  ["0 8 * * 1-5", "2026-11-27T09:00:00.000Z", "2026-11-30T08:00:00.000Z"],
  ["30 9,17 * * *", after, "2026-11-25T17:30:00.000Z"],
  ["0 0 1 * *", after, "2026-12-01T00:00:00.000Z"],
  ["0 0 * * 0", after, "2026-11-29T00:00:00.000Z"],
  ["0 0 * * 7", after, "2026-11-29T00:00:00.000Z"],
  ["5-10/2 * * * *", "2026-11-25T10:06:00.000Z", "2026-11-25T10:07:00.000Z"],
  ["5/20 * * * *", "2026-11-25T10:26:00.000Z", "2026-11-25T10:45:00.000Z"],
  ["0 12 29 2 *", after, "2028-02-29T12:00:00.000Z"],
  ["0 0 13 * 5", "2026-11-25T00:00:00.000Z", "2026-11-27T00:00:00.000Z"],
  ["0 0 1 1 *", "2026-12-31T23:59:00.000Z", "2027-01-01T00:00:00.000Z"],
  ["17 10 * * *", "2026-11-25T10:17:00.000Z", "2026-11-26T10:17:00.000Z"],
]

const invalid: [schedule: string, error: RegExp][] = [
  ["* * * *", /5 fields/],
  ["* * * * * *", /5 fields/],
  ["60 * * * *", /minute.*outside 0-59/],
  ["* 24 * * *", /hour.*outside/],
  ["* * 0 * *", /day of month.*outside 1-31/],
  ["* * * 13 *", /month.*outside/],
  ["* * * * 8", /day of week.*outside/],
  ["*/0 * * * *", /step/],
  ["10-5 * * * *", /backwards/],
  ["a * * * *", /not a value/],
  ["1,,2 * * * *", /not a value/],
  ["0 0 30 2 *", /never fires/],
]

describe("cron schedules (UTC)", () => {
  test.each(next)("%s after %s fires at %s", (schedule, from, expected) => {
    expect(nextRunOf(schedule, new Date(from))?.toISOString()).toBe(expected)
  })

  test.each(invalid)("%s is refused", (schedule, error) => {
    const parsed = parseCron(schedule)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(error)
  })
})
