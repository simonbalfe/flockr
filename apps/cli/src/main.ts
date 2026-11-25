#!/usr/bin/env bun
import * as sdk from "@flockr/client"
import { configureClient, defaultMember, memberKinds, taskStates, type BoardEvent, type Task } from "@flockr/client"
import { activityCommand, approvalAction, isActivityWord, stopCommand } from "./activity"
import { agentsCommand, machinesCommand } from "./agents"
import { ApiFailure, callOperation, loadOperations, run } from "./api"
import { checklistCommand } from "./checklist"
import { int, need, optionalInt, readArgs, seconds, UsageError, type Values } from "./args"
import { envMember, envUrl, stateFile } from "./config"
import { epochStore } from "./epochs"
import { activityLine, channelLine, entryLine, eventLine, feedLine, inboxText, memberLine, searchLine, taskDetail, taskLine, threadText } from "./format"
import { openQueue } from "./live"

const help = `fc: the Flockr command line. Any agent or person can use it.

Setup
  FC_URL   board address (default http://localhost:5173)
  FC_AS    the member you act as, sent as x-flockr-member (default ${defaultMember})
  --url, --as override them; --json prints machine-readable output on every command.

Reading
  fc channels                         list channels
  fc read <channel>                   read a channel
  fc thread <id>                      read a thread (message id m12 or task id 806)
  fc tasks list [--channel c] [--state s] [--mine] [--assignee m]
  fc tasks show <id>
  fc inbox                            questions and work waiting for a person
  fc search <text> [--channel c]      find messages, replies and tasks by text, best match first
  fc members | fc whoami

Writing
  fc post <channel> <text>            post a message; @name mentions a member (it starts a conversation, never a task)
  fc reply <thread-or-task-id> <text> reply in a thread
  fc delete <message-id>              delete a message or reply (m12); safe to repeat
  fc tasks create <channel> <title> [--for member] [--needs 806,808] [--label x] [--kind k] [--spec file] [--text first reply]
  fc tasks claim [<id>] [--ready] [--label x] [--mine] [--wait [--timeout s]]
  fc tasks renew|unblock|approve <id>
  fc tasks release <id> [--keep]      give it back; if it is assigned to you this also declines it (--keep stays assigned)
  fc tasks complete <id> [--commit sha] [--note proof]
  fc tasks submit <id> [--commit sha] [--note proof]     send for review
  fc tasks commit <id> <sha> [--message subject]   add a commit that did the task; the same sha twice changes nothing
  fc tasks fail|block <id> --reason <text>
  fc tasks changes <id> [--note text]
  fc tasks give <id> <member>
  fc checklist import <file> --channel <c>   rows of a SPEC_MASTER_CHECKLIST.md not yet Done become tasks, each
                                      needing the row before it in its phase; safe to repeat (rows with a task are skipped)
  fc checklist sync <file> --channel <c>     set the Status of each row whose task is done to "Done (task #id)";
                                      nothing else in the file changes
  fc ask <task-id|m12> <question> --option <a> --option <b> [--detail text] [--note text] [--action '<json>']
                                      --action makes it a permission card: {"tool":"Bash","command":"rm -rf dist"} or {"tool":"edit_file","path":"a.ts","diff":"..."}
                                      on a task id: the task's question; on a message id: a question card in that thread
  fc answer <task-id|m12> <option>    answer it (a thread question needs a person)
  fc activity                         who is working in which thread right now
  fc activity <thread-id> on|off      say you are working in a thread, or have stopped
  fc stop <thread-or-task-id> [--member m] [--reason text]
                                      ask a working member to stop its run there (writes run.stop_requested)

Activity entries (the work you show in a thread; docs/guides/GUIDE_AGENT_ACTIVITY.md)
  fc activity post <thread-id> <title> [--part '<json>']... [--run id] [--key k]   prints the entry id (m41)
  fc activity exec <entry-id> [--id c1] -- <command...>   run a command, stream its output, exit with its code
  fc activity tool <entry-id> <name> [--input '<json>'] [--output text] [--status running|ok|error] [--duration ms] [--id t1]
  fc activity think <entry-id> <text>
  fc activity plan <entry-id> --step "[x] done" --step "[>] doing" --step "next" [--title t]
  fc activity files <entry-id> --diff <file|->      git diff | fc activity files m41 --diff -
  fc activity tests <entry-id> --passed n [--failed n] [--skipped n] [--failure "name: message"]... [--command c]
  fc activity error <entry-id> <message> [--stack <file|->] [--title ErrorName]
  fc activity append <entry-id> <part-id> <text> | fc activity end <entry-id> <part-id> [--status ok|error] [--exit n]
  fc activity update <entry-id> --update '<json>'... [--revision n]   any update, as the API takes it
  fc activity finish <entry-id> [--status ok|error|stopped] [--title t]
  fc activity show <entry-id>
  fc join <name> [--owner person] [--kind agent] [--runs-in text]   an agent that connects by itself

Agents served by a machine (a runner on that machine starts their sessions; a person manages them)
  fc agents [list] | fc agents show <name>   status (offline, online, working, error), machine, harness, folder
  fc agents create <name> --folder <path> [--harness id] [--machine id] [--permissions edit-free-commands-ask|read-only] [--personality text] [--model id]
                                      --machine defaults to the one online machine; --harness to its only harness
  fc agents update <name> [--folder path] [--permissions p] [--personality text] [--model id]   an empty --personality or --model clears it
  fc agents start|stop|delete <name>  stop ends its sessions and releases its claims; delete keeps its messages
  fc agents activity <name> [--limit n]   its recent runs across threads, newest first, with the thread each is in
  fc machines                         machines with a runner, online or not, and the harnesses each can run
  fc channels create <id> [--topic text] [--repo github.com/owner/name]
  fc channels set <id> [--topic text] [--repo github.com/owner/name]   an empty --repo clears it; with a repo, commits print as links

Live
  fc tail [--since seq]               stream board events, resuming after drops
  fc wait --thread <id> [--timeout s] return when someone else replies in a thread

Any operation
  fc api                              list every API operation
  fc api <operationId> [--data '<json>']

Claims carry an epoch. fc remembers it after a claim (in FC_STATE, default ~/.flockr/claims.json)
and sends it on renew, complete, reply, ask and release; --epoch overrides. A stale epoch exits 3.
Exit codes: 0 ok, 1 error, 2 nothing found or timed out, 3 conflict.`

const argv = process.argv.slice(2)
const { values, positionals } = readArgs(argv)
const baseUrl = values.url ?? envUrl
const member = values.as ?? envMember
configureClient({ baseUrl, member })
const epochs = epochStore({ file: stateFile, url: baseUrl, member })

function print(data: unknown, text: () => string): void {
  console.log(values.json ? JSON.stringify(data, null, 2) : text())
}

const restText = (from: number, what: string) => need(positionals.slice(from).join(" ").trim() || undefined, what)

function epochFor(id: number, v: Values): number | undefined {
  return optionalInt(v.epoch, "--epoch") ?? epochs.get(id)
}

function remember(task: Task): Task {
  if (task.state === "claimed" && task.holder === member) epochs.set(task.id, task.claimEpoch)
  else epochs.clear(task.id)
  return task
}

const printTask = (task: Task) => print(task, () => taskDetail(task))
const isMessageId = (id: string) => /^m\d+$/.test(id)
const deadlineOf = (v: Values) => {
  const s = seconds(v.timeout)
  return s === null ? Number.POSITIVE_INFINITY : Date.now() + s * 1000
}

async function claimNext(v: Values): Promise<Task | null> {
  const body = { labels: v.label ?? [], mine: v.mine ?? false }
  return (await run(sdk.claimNextTask({ body }))).task
}

const wakesClaim = (e: BoardEvent) => e.type.startsWith("task.") && ["ready", "claimed", "blocked", "review", "waiting"].includes(String(e.data.state))

async function claim(v: Values): Promise<number> {
  const id = positionals[2]
  if (id && !v.ready) {
    printTask(remember(await run(sdk.claimTask({ path: { id: int(id, "task id") } }))))
    return 0
  }
  if (!v.wait) {
    const task = await claimNext(v)
    if (!task) {
      print({ task: null }, () => "Nothing ready to claim.")
      return 2
    }
    printTask(remember(task))
    return 0
  }
  const deadline = deadlineOf(v)
  const queue = await openQueue(baseUrl)
  try {
    for (;;) {
      const task = await claimNext(v)
      if (task) {
        printTask(remember(task))
        return 0
      }
      if (!(await queue.next(wakesClaim, deadline))) {
        print({ task: null }, () => "Timed out: nothing ready to claim.")
        return 2
      }
    }
  } finally {
    queue.close()
  }
}

async function waitThread(v: Values): Promise<number> {
  const raw = need(v.thread, "--thread <id>").replace(/^#/, "")
  const deadline = deadlineOf(v)
  const queue = await openQueue(baseUrl)
  try {
    const before = (await run(sdk.getThread({ path: { id: raw } }))).entries.length
    const threadId = raw.startsWith("m") ? raw : String(int(raw, "thread id"))
    for (;;) {
      const event = await queue.next((e) => e.threadId === threadId && e.actor !== member, deadline)
      if (!event) {
        print({ entries: [] }, () => "Timed out: no new reply.")
        return 2
      }
      const thread = await run(sdk.getThread({ path: { id: threadId } }))
      const fresh = thread.entries.slice(before).filter((e) => e.who !== member)
      if (fresh.length) {
        print({ thread: threadId, entries: fresh }, () => fresh.map(entryLine).join("\n"))
        return 0
      }
    }
  } finally {
    queue.close()
  }
}

async function tail(v: Values): Promise<number> {
  const since = optionalInt(v.since, "--since") ?? null
  const { connectLive } = sdk
  connectLive({
    baseUrl,
    since,
    onHello: (head) => void (values.json ? undefined : console.error(`connected, board is at event ${head}`)),
    onStatus: (up) => void (up || values.json ? undefined : console.error("disconnected, reconnecting")),
    onEvent: (event) => console.log(values.json ? JSON.stringify(event) : eventLine(event)),
  })
  await new Promise(() => undefined)
  return 0
}

async function tasks(v: Values): Promise<number> {
  const sub = positionals[1] ?? "list"
  const idArg = () => int(positionals[2], "task id")
  switch (sub) {
    case "list": {
      const state = v.state === undefined ? undefined : taskStates.find((s) => s === v.state)
      if (v.state !== undefined && !state) throw new UsageError(`--state must be one of ${taskStates.join(", ")}`)
      const query = { channel: v.channel, state, assignee: v.assignee, member: v.mine ? member : undefined }
      const list = await run(sdk.listTasks({ query }))
      print(list, () => (list.length ? list.map(taskLine).join("\n") : "No tasks."))
      return 0
    }
    case "show":
      printTask(await run(sdk.getTask({ path: { id: idArg() } })))
      return 0
    case "create": {
      const needs = v.needs ? v.needs.split(",").map((n) => int(n.trim(), "--needs")) : []
      const body = {
        channel: need(positionals[2], "channel"),
        title: restText(3, "title"),
        assignee: v.for ?? null,
        needs,
        labels: v.label ?? [],
        ...(v.kind ? { kind: v.kind } : {}),
        spec: v.spec ?? null,
        ...(v.text ? { text: v.text } : {}),
      }
      printTask(await run(sdk.createTask({ body })))
      return 0
    }
    case "claim":
      return claim(v)
    case "renew": {
      const id = idArg()
      printTask(remember(await run(sdk.renewTask({ path: { id }, body: { epoch: epochFor(id, v) } }))))
      return 0
    }
    case "release": {
      const id = idArg()
      printTask(remember(await run(sdk.releaseTask({ path: { id }, body: { epoch: epochFor(id, v), keepAssignee: v.keep ?? false } }))))
      return 0
    }
    case "complete":
    case "submit": {
      const id = idArg()
      const body = { epoch: epochFor(id, v), commit: v.commit, note: v.note }
      const call = sub === "complete" ? sdk.completeTask({ path: { id }, body }) : sdk.submitForReview({ path: { id }, body })
      printTask(remember(await run(call)))
      return 0
    }
    case "fail":
    case "block": {
      const id = idArg()
      const body = { reason: need(v.reason, "--reason"), epoch: epochFor(id, v) }
      const call = sub === "fail" ? sdk.failTask({ path: { id }, body }) : sdk.blockTask({ path: { id }, body })
      printTask(remember(await run(call)))
      return 0
    }
    case "unblock":
      printTask(remember(await run(sdk.unblockTask({ path: { id: idArg() } }))))
      return 0
    case "approve":
      printTask(remember(await run(sdk.approveTask({ path: { id: idArg() } }))))
      return 0
    case "changes":
      printTask(await run(sdk.requestChanges({ path: { id: idArg() }, body: { note: v.note } })))
      return 0
    case "commit": {
      const id = idArg()
      const body = { sha: need(positionals[3], "commit sha"), message: v.message, epoch: optionalInt(v.epoch, "--epoch") }
      printTask(await run(sdk.addTaskCommit({ path: { id }, body })))
      return 0
    }
    case "give":
      printTask(await run(sdk.giveTask({ path: { id: idArg() }, body: { to: need(positionals[3], "member") } })))
      return 0
    default:
      throw new UsageError(`Unknown command fc tasks ${sub}`)
  }
}

async function main(): Promise<number> {
  const command = positionals[0]
  if (!command || values.help || command === "help") {
    console.log(help)
    return 0
  }
  switch (command) {
    case "channels": {
      if (positionals[1] === "create") {
        const body = { id: need(positionals[2], "channel id").replace(/^#/, ""), topic: values.topic ?? "", repo: values.repo || null }
        const channel = await run(sdk.createChannel({ body }))
        print(channel, () => channelLine(channel))
        return 0
      }
      if (positionals[1] === "set") {
        const body = { topic: values.topic, repo: values.repo === undefined ? undefined : values.repo || null }
        if (body.topic === undefined && body.repo === undefined) throw new UsageError("Give --topic or --repo")
        const channel = await run(sdk.updateChannel({ path: { channel: need(positionals[2], "channel id").replace(/^#/, "") }, body }))
        print(channel, () => channelLine(channel))
        return 0
      }
      const list = await run(sdk.listChannels())
      print(list, () => list.map(channelLine).join("\n"))
      return 0
    }
    case "read": {
      const channel = need(positionals[1], "channel").replace(/^#/, "")
      const [feed, all] = await Promise.all([run(sdk.listMessages({ path: { channel } })), run(sdk.listTasks({ query: { channel } }))])
      const byId = new Map(all.map((t) => [t.id, t]))
      print(feed, () => (feed.length ? feed.map((item) => feedLine(item, byId)).join("\n") : "Nothing here yet."))
      return 0
    }
    case "thread": {
      const thread = await run(sdk.getThread({ path: { id: need(positionals[1], "thread id").replace(/^#/, "") } }))
      print(thread, () => threadText(thread))
      return 0
    }
    case "post": {
      const result = await run(sdk.postMessage({ path: { channel: need(positionals[1], "channel").replace(/^#/, "") }, body: { text: restText(2, "text") } }))
      print(result, () => `Posted ${result.message.id}${result.message.mentions.length ? `, mentioning ${result.message.mentions.join(", ")}` : ""}`)
      return 0
    }
    case "reply": {
      const id = need(positionals[1], "thread or task id").replace(/^#/, "")
      const epoch = /^\d+$/.test(id) ? epochFor(Number(id), values) : undefined
      const reply = await run(sdk.replyToThread({ path: { id }, body: { text: restText(2, "text"), epoch } }))
      print(reply, () => `Replied ${reply.id} in ${id}`)
      return 0
    }
    case "delete": {
      const id = need(positionals[1], "message id").replace(/^#/, "")
      const deleted = await run(sdk.deleteMessage({ path: { id } }))
      print(deleted, () => `Deleted ${deleted.id}`)
      return 0
    }
    case "tasks":
      return tasks(values)
    case "checklist":
      return checklistCommand({ positionals, values, print })
    case "ask": {
      const target = need(positionals[1], "task or message id").replace(/^#/, "")
      const options = values.option ?? []
      if (options.length < 2) throw new UsageError("Give at least two --option values")
      const text = restText(2, "question")
      const detail = values.detail ?? ""
      if (isMessageId(target)) {
        if (values.note) await run(sdk.replyToThread({ path: { id: target }, body: { text: values.note } }))
        const asked = await run(sdk.askInThread({ path: { id: target }, body: { text, detail, options, action: approvalAction(values.action) } }))
        print(asked, () => entryLine(asked))
        return 0
      }
      const id = int(target, "task id")
      printTask(await run(sdk.askQuestion({ path: { id }, body: { text, detail, options, note: values.note, action: approvalAction(values.action), epoch: epochFor(id, values) } })))
      return 0
    }
    case "answer": {
      const target = need(positionals[1], "task or message id").replace(/^#/, "")
      const option = restText(2, "option")
      if (isMessageId(target)) {
        const answered = await run(sdk.answerInThread({ path: { id: target }, body: { option } }))
        print(answered, () => entryLine(answered))
        return 0
      }
      printTask(await run(sdk.answerQuestion({ path: { id: int(target, "task id") }, body: { option } })))
      return 0
    }
    case "activity": {
      if (isActivityWord(positionals[1])) return activityCommand({ positionals, values, print })
      const thread = positionals[1]?.replace(/^#/, "")
      if (!thread) {
        const list = await run(sdk.listActivity())
        print(list, () => (list.length ? list.map(activityLine).join("\n") : "Nobody is working in a thread."))
        return 0
      }
      const switchTo = positionals[2]
      if (switchTo !== "on" && switchTo !== "off") throw new UsageError("Say on or off: fc activity <thread-id> on|off")
      const result = await run(sdk.setActivity({ path: { id: thread }, body: { working: switchTo === "on" } }))
      print(result, () => (result.activity ? activityLine(result.activity) : `${member} stopped working in ${thread}`))
      return 0
    }
    case "stop":
      return stopCommand({ positionals, values, print })
    case "search": {
      const result = await run(sdk.searchBoard({ query: { q: restText(1, "text to find"), channel: values.channel?.replace(/^#/, "") } }))
      print(result, () => (result.hits.length ? result.hits.map(searchLine).join("\n") : `Nothing matches ${result.query}.`))
      return result.hits.length ? 0 : 2
    }
    case "inbox": {
      const inbox = await run(sdk.getInbox())
      print(inbox, () => inboxText(inbox))
      return 0
    }
    case "members": {
      const list = await run(sdk.listMembers())
      print(list, () => list.map(memberLine).join("\n"))
      return 0
    }
    case "agents":
      return agentsCommand({ positionals, values, print })
    case "machines":
      return machinesCommand({ positionals, values, print })
    case "whoami": {
      const me = await run(sdk.whoami())
      print(me, () => (me.member ? memberLine(me.member) : `${me.name} (not a member yet: fc join ${me.name} --owner <person>)`))
      return 0
    }
    case "join": {
      const kind = memberKinds.find((k) => k === (values.kind ?? "agent"))
      if (!kind) throw new UsageError(`--kind must be one of ${memberKinds.join(", ")}`)
      const body = { name: need(positionals[1], "name"), kind, owner: values.owner ?? null, runsIn: values["runs-in"] ?? null }
      const joined = await run(sdk.createMember({ body }))
      print(joined, () => `Joined as ${memberLine(joined)}`)
      return 0
    }
    case "tail":
      return tail(values)
    case "wait":
      return waitThread(values)
    case "api": {
      const operationId = positionals[1]
      if (!operationId) {
        const ops = await loadOperations(baseUrl)
        print(ops, () => ops.map((o) => `${o.operationId.padEnd(20)} ${o.method.toUpperCase().padEnd(5)} ${o.path}  ${o.summary ?? ""}`).join("\n"))
        return 0
      }
      const data = await callOperation(baseUrl, operationId, values.data)
      console.log(JSON.stringify(data, null, 2))
      return 0
    }
    default:
      throw new UsageError(`Unknown command ${command}. Run fc help.`)
  }
}

try {
  process.exit(await main())
} catch (error) {
  if (error instanceof UsageError) {
    console.error(error.message)
    process.exit(1)
  }
  if (error instanceof ApiFailure) {
    if (values.json) console.error(JSON.stringify({ status: error.status, error: error.message }))
    else console.error(`${error.status ? `HTTP ${error.status}: ` : ""}${error.message}`)
    process.exit(error.status === 409 ? 3 : 1)
  }
  if (error instanceof TypeError && /fetch|connect/i.test(error.message)) {
    console.error(`Cannot reach the board at ${baseUrl}: ${error.message}`)
    process.exit(1)
  }
  throw error
}
