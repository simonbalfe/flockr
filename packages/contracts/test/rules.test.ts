import { describe, expect, test } from "bun:test"
import { mentionsIn } from "../src/rules"

describe("mentions", () => {
  const members = new Set(["claude", "codex"])
  test("match any case, once each, and only members", () => {
    expect(mentionsIn("@Claude whats up, @CLAUDE and @codex? @nobody", members)).toEqual(["claude", "codex"])
  })
  test("an email address is not a mention", () => {
    expect(mentionsIn("mail simon@claude.dev", members)).toEqual([])
  })
})
