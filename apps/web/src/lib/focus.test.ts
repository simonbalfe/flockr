import { describe, expect, test } from "bun:test"
import type { Task, ThreadQuestion } from "@flockr/client"
import { needItems, threadOf } from "./focus"

const at = (minute: number) => new Date(Date.UTC(2026, 10, 25, 9, minute)).toISOString()

function task(id: number, minute: number, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    channel: "backend",
    kind: "task",
    state: "claimed",
    needs: [],
    labels: [],
    assignee: null,
    holder: "claude",
    leaseExpiresAt: null,
    claimEpoch: 1,
    spec: null,
    branch: `flockr/${id}`,
    commits: [],
    reason: null,
    question: null,
    replyCount: 0,
    planId: null,
    reviewer: null,
    reviewCommit: null,
    createdAt: at(minute),
    ...over,
  }
}

const threadQuestion: ThreadQuestion = {
  kind: "question",
  id: "m40",
  threadId: "m12",
  channel: "frontend",
  who: "gemini",
  at: at(5),
  question: { text: "Use the new form?", detail: "", options: ["Yes", "No"] },
  answer: null,
  answeredBy: null,
}

describe("needItems", () => {
  test("merges every kind oldest first", () => {
    const items = needItems({
      questions: [task(808, 20)],
      threadQuestions: [threadQuestion],
      reviews: [task(806, 10, { state: "review", holder: "codex" })],
      blocked: [task(815, 1, { state: "blocked", holder: null, assignee: "gemini" })],
    })
    expect(items.map((item) => item.key)).toEqual(["blocked-815", "thread-m40", "review-806", "question-808"])
    expect(items.map((item) => item.who)).toEqual(["gemini", "gemini", "codex", "claude"])
    expect(items.map(threadOf)).toEqual(["815", "m12", "806", "808"])
  })

  test("a blocked card names its assignee, else its holder, else nobody", () => {
    const items = needItems({
      questions: [],
      threadQuestions: [],
      reviews: [],
      blocked: [task(298, 1, { state: "blocked", holder: null }), task(299, 2, { state: "blocked", holder: "codex", assignee: "gemini" }), task(300, 3, { state: "blocked", holder: "codex" })],
    })
    expect(items.map((item) => item.who)).toEqual([null, "gemini", "codex"])
  })

  test("a task asking a question and blocked is two cards", () => {
    const same = task(812, 3)
    const keys = needItems({ questions: [same], threadQuestions: [], reviews: [], blocked: [same] }).map((item) => item.key)
    expect(keys).toEqual(["question-812", "blocked-812"])
  })
})
