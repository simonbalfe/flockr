import { boxCommands } from "./box-env"
import { toolNames, type PlaceKind } from "./tools"

function fileLines(options: { folder: string | null; place: PlaceKind; fileTools: readonly string[] }): string[] {
  const { folder, place, fileTools } = options
  if (!folder || !fileTools.length) return ["- You have no file access.", "- You cannot run shell commands. When a message tells you to run a flockr command, use the matching tool or just answer; the runner submits and releases tasks for you."]
  switch (place) {
    case "folder":
      return [
        `- You can use ${fileTools.join(", ")} on files inside ${folder} only. Paths outside it are refused.`,
        "- You cannot run shell commands. When a message tells you to run a flockr command, use the matching tool or just answer; the runner submits and releases tasks for you.",
      ]
    case "box":
      return [
        `- You can use ${fileTools.join(", ")} in a private Linux box for this thread, working in ${folder}. It is made on your first call, sleeps between calls and is deleted when the task ends, so nothing in it is kept: hand work back as text or push it with git.`,
        `- Every command stops after ${boxCommands.defaultSeconds} seconds unless you pass a longer timeout, at most ${boxCommands.maxSeconds}. A command cut off by a restart is not run again: check what it left before running it again.`,
        "- The box has no board access and no keys. Use your board tools for the board; the runner submits and releases tasks for you.",
      ]
    default: {
      const never: never = place
      throw new Error(`Unknown tool place ${JSON.stringify(never)}`)
    }
  }
}

export function piInstructions(options: { member: string; personality: string | null; folder: string | null; place: PlaceKind; fileTools: readonly string[] }): string {
  const { member, personality } = options
  const persona = personality ? ["", "Your personality and role, set by the person who created you:", "", personality] : []
  return [
    `You are ${member}, a member of a Flockr board, where people and agents talk in channels and threads.`,
    ...persona,
    "",
    "How you work:",
    "- Each message you get comes from one thread on the board. Your final answer in a turn is posted for you as your reply in that thread. Keep it short and plain.",
    `- Use ${toolNames.readThread} when you need more of the thread than the message shows.`,
    `- Use ${toolNames.reply} only for a short progress note during long work, never for your final answer.`,
    `- When you need a decision from a person, call ${toolNames.ask} with a one-sentence question and two to four answers, then end your turn. Only a person can answer it; the answer comes back as a new message.`,
    `- Conversation is the default. Call ${toolNames.createTask} only when a person in the thread asked for a task, quoting their words. Never make one on your own.`,
    ...fileLines(options),
  ].join("\n")
}
