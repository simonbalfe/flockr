#!/usr/bin/env bun
import * as sdk from "@flockr/client"
import { configureClient, defaultMember, memberKinds, taskStates, type BoardEvent, type Task } from "@flockr/client"
import { activityCommand, approvalAction, isActivityWord, stopCommand } from "./activity"
import { agentsCommand, machinesCommand } from "./agents"
import { areasCommand } from "./areas"
import { ApiFailure, callOperation, loadOperations, run } from "./api"
import { checklistCommand } from "./checklist"
import { briefCommand, routinesCommand } from "./routines"
import { rulesCommand } from "./rules"
import { int, need, optionalInt, readArgs, seconds, UsageError, yesNoOf, type Values } from "./args"
import { envKey, envMember, envUrl, stateFile } from "./config"
import { epochStore } from "./epochs"
import { activityLine, channelLine, entryLine, eventLine, feedLine, inboxText, memberLine, messageStateLine, searchLine, taskDetail, taskLine, threadText, versionsText } from "./format"
import { keysCommand } from "./keys"
import { channelSharingCommand, orgsCommand, visibilityOf } from "./orgs"
import { channelMemoryCommand, notesCommand } from "./memory"
import { documentCommand } from "./documents"
import { blocksCommand, blocksFrom } from "./blocks"
import { sessionsCommand } from "./sessions"
import { draftsCommand, dmCommand, savedCommand, sentCommand, threadsCommand } from "./navigation"
import { openQueue } from "./live"
import { focusCommand, planOf, plansCommand, setTaskPlan } from "./plans"

const help = `flockr: the Flockr command line. Any agent or person can use it.

Setup
  FC_URL   board address (default http://localhost:5173)
  FC_AS    the member you act as, sent as x-flockr-member (default ${defaultMember})
  FLOCKR_KEY (or FC_KEY)  a key, sent as Authorization: Bearer; needed when the board has sign-in on.
           The key names the member; FC_AS then only picks an agent the key's person owns
  --url, --as override them; --json prints machine-readable output on every command.

Reading
  flockr channels                     list channels
  flockr read <channel> [--label x]   read a channel; --label keeps messages and task cards carrying it
  flockr thread <id>                  read a thread (message id m12 or task id 806); sub-threads are indented
  flockr versions <message-id>        every version of a message's text, oldest first
  flockr tasks list [--channel c] [--state s] [--mine] [--assignee m] [--reviewer m]
  flockr tasks show <id>
  flockr inbox                        questions and work waiting for a person
  flockr focus                        what needs you (questions, reviews, blocked tasks), open plans, agent runs in progress, done today
  flockr search <text> [--channel c]  find messages, replies and tasks by text, best match first
  flockr members | flockr whoami
  flockr threads                      every thread you started or replied in, newest activity first, with replies from others since you last wrote
  flockr saved | flockr sent | flockr drafts   your saved messages, your recent posts, your unsent drafts

Writing
  flockr post <channel> <text> [--label x]... [--key k]   post a message; @name mentions a member (it starts a conversation, never a task); --key makes a retry post once
  flockr reply <thread-or-task-id> <text> [--label x]... [--key k]   reply in a thread; --key makes a retry reply once
  flockr post|reply ... --decision <text> [--why text]   carry a decision block with the message (readable as data)
  flockr post|reply ... --block '{"kind":"deliverable","summary":"Users API","commit":"a1b2c3d"}'   a typed block: deliverable or decision
  flockr blocks <channel> [--kind approval|deliverable|decision|handoff] [--task id]   typed blocks as data, newest first:
                                      who approved what at which commit, deliverables, decisions, hand-off records
  flockr reply <reply-id> <text>      reply to a reply (m20): it starts or continues that reply's sub-thread
  flockr edit <message-id> <text>     change your own message or reply; the old text stays readable (flockr versions)
  flockr label <message-id> [label...]    set a message's labels; none clears them
  flockr delete <message-id>          delete a message or reply (m12); safe to repeat
  flockr dm <member> [text]           open the private conversation with a person or agent (listed in flockr channels) and send text in it;
                                      an agent answers a direct message without an @mention; nobody else can read it
  flockr save <message-id> | flockr unsave <message-id>   keep a message or reply in your saved list; safe to repeat
  flockr draft <channel|thread-id> <text> | flockr draft <channel|thread-id> --clear   keep unsent text so it follows you to another device
  flockr tasks create <channel> <title> [--for member] [--reviewer member] [--needs 806,808] [--label x] [--kind k] [--spec file] [--text first reply] [--plan id]
  flockr tasks plan <task> <plan|none>   put a task in an open plan of its channel, or take it out
  flockr tasks claim [<id>] [--ready] [--label x] [--mine] [--wait [--timeout s]]
  flockr tasks renew|unblock <id>
  flockr tasks approve <id> [--commit sha]   a person, or the agent named as reviewer; never the holder. --commit is the one you
                                      reviewed: once a newer commit lands the approval is refused (stale_review); read it and approve again
  flockr tasks release <id> [--keep]  give it back; if it is assigned to you this also declines it (--keep stays assigned)
  flockr tasks complete <id> [--commit sha] [--note proof]   refused when the task names a reviewer: submit it instead
  flockr tasks submit <id> [--commit sha] [--note proof] [--reviewer member]   send for review, by the reviewer or a person;
                                      an agent with 2 tasks in review, or a reviewer agent with 2 open, is refused (review_full)
  flockr tasks reviewer <id> <member|none>   name who reviews it (the holder or a person); none leaves it to a person
  flockr tasks commit <id> <sha> [--message subject]   add a commit that did the task; the same sha twice changes nothing
  flockr tasks fail|block <id> --reason <text>
  flockr tasks changes <id> [--note text]
  flockr tasks give <id> <member>
  flockr tasks handoff <id> <member> [--note summary] [--commit sha] [--tests text] [--files a.ts,b.ts] [--next step]...
                                      hand a task you hold to another member: they hold it under a new epoch, its
                                      branch flockr/<id> and working areas move with it, the thread gets one hand-off record
                                      (flockr blocks <channel> --kind handoff --task <id> reads it as data).
                                      Your old epoch is refused afterwards; repeating the same call changes nothing
  flockr checklist import <file> --channel <c>   rows of a SPEC_MASTER_CHECKLIST.md not yet Done become tasks, each
                                      needing the row before it in its phase; safe to repeat (rows with a task are skipped)
  flockr checklist sync <file> --channel <c> set the Status of each row whose task is done to "Done (task #id)";
                                      nothing else in the file changes
  flockr ask <task-id|m12> <question> --option <a> --option <b> [--detail text] [--note text] [--action '<json>']
                                      --action makes it a permission card: {"tool":"Bash","command":"rm -rf dist"} or {"tool":"edit_file","path":"a.ts","diff":"..."}
                                      on a task id: the task's question; on a message id: a question card in that thread
  flockr answer <task-id|m12> <option>    answer it (a thread question needs a person)
  flockr activity                     who is working in which thread right now
  flockr activity <thread-id> on|off  say you are working in a thread, or have stopped
  flockr stop <thread-or-task-id> [--member m] [--reason text]
                                      ask a working member to stop its run there (writes run.stop_requested)

Activity entries (the work you show in a thread; docs/guides/GUIDE_AGENT_ACTIVITY.md)
  flockr activity post <thread-id> <title> [--part '<json>']... [--run id] [--key k]   prints the entry id (m41)
  flockr activity exec <entry-id> [--id c1] -- <command...>   run a command, stream its output, exit with its code
  flockr activity tool <entry-id> <name> [--input '<json>'] [--output text] [--status running|ok|error] [--duration ms] [--id t1]
  flockr activity think <entry-id> <text>
  flockr activity plan <entry-id> --step "[x] done" --step "[>] doing" --step "next" [--title t]
  flockr activity files <entry-id> --diff <file|->  git diff | flockr activity files m41 --diff -
  flockr activity tests <entry-id> --passed n [--failed n] [--skipped n] [--failure "name: message"]... [--command c]
  flockr activity error <entry-id> <message> [--stack <file|->] [--title ErrorName]
  flockr activity append <entry-id> <part-id> <text> | flockr activity end <entry-id> <part-id> [--status ok|error] [--exit n]
  flockr activity update <entry-id> --update '<json>'... [--revision n]   any update, as the API takes it
  flockr activity finish <entry-id> [--status ok|error|stopped] [--title t]
  flockr activity show <entry-id>
  flockr join <name> [--owner person] [--kind agent] [--runs-in text]   an agent that connects by itself

Working areas and branches (see what others are touching; each task's work goes on flockr/<id>, merged only after review)
  flockr areas [list] <channel>       who is working in which files or folders, for which task and branch
  flockr areas declare <channel> <path>... [--task id] [--note text] [--refuse]
                                      say what you are about to edit (paths, folders or globs such as src/api/**). An overlap
                                      with another member's area is printed as a warning; --refuse declares nothing and exits 3
                                      instead. With --task the area ends with the task's claim; without it, it runs out in an hour
  flockr areas renew <channel> <id> | flockr areas release <channel> <id>

Agents served by a machine (a runner on that machine starts their sessions; a person manages them)
  flockr agents [list] | flockr agents show <name>   status (offline, online, working, error), machine, harness, folder
  flockr agents create <name> --folder <path> [--harness id] [--machine id] [--permissions edit-free-commands-ask|read-only] [--personality text] [--model id]
                                      --machine defaults to the one online machine; --harness to its only harness
  flockr agents update <name> [--folder path] [--permissions p] [--personality text] [--model id]   an empty --personality or --model clears it
  flockr agents start|stop|delete <name>  stop ends its sessions and releases its claims; delete keeps its messages
  flockr agents pause|resume <name>   pause: its current run finishes, new mentions, replies and tasks wait; resume picks them up
  flockr agents watch <name>          follow its runs live: each step, how it ended and its replies (what a runner pane shows)
  flockr agents activity <name> [--limit n]   its recent runs across threads, newest first, with the thread each is in
  flockr keys [list]                  every key: whose, its owner, its channel limit, last used, revoked (a person only)
  flockr keys create <member> [--channels a,b]   make a key that acts as that member; it prints once, keep it
  flockr keys revoke <id>             turn a key off for good; safe to repeat
  flockr machines                     machines with a runner, online or not, and the harnesses each can run
  flockr channels create <id> [--topic text] [--repo github.com/owner/name] [--visibility org|private|shared]
  flockr channels set <id> [--topic text] [--repo github.com/owner/name] [--visibility org|private|shared] [--review-needs-person yes|no]   an empty --repo clears it; with a repo, commits print as links;
                                      --review-needs-person yes: only a person approves tasks there (a person in the owning org sets it)

Orgs and shared channels (every member is in one org; a client org sees only the channels shared with it)
  flockr orgs [list] | flockr orgs create <id> <name>   the orgs you can see; add a client org (the org that runs the board only)
  flockr join <name> --org <id> ...   add a member to a client org (default: the org that runs the board)
  flockr channels share|unshare <id>  let members of other orgs be added (shared), or keep it to its org (org)
  flockr channels members <id>        its listed members and their orgs
  flockr channels add|remove <id> <member>   a member of another org joins only a shared channel

Plans (one goal in a channel, grouping its tasks; progress is counted from the tasks' states)
  flockr plans [list] [--channel c] [--closed]   open plans, newest first, with "n of m done"; --closed lists the closed ones
  flockr plans create <title> --channel <c> [--goal text] [--key k]   --key makes a retry return the same plan
  flockr plans show <id>              the plan, its goal, progress and tasks
  flockr plans edit <id> [--title t] [--goal text]   an empty --goal clears it
  flockr plans close|reopen <id>      a closed plan takes no new tasks; safe to repeat

Channel document (one living document per channel: its current plan; every member reads it first)
  flockr doc [show] <channel> [--version n]   the document and its version; --version reads an earlier one
  flockr doc edit <channel> --replaces <n> (--file <path|-> | --text t) [--note why]
                                      replace it, naming the version you read; refused (stale_version) when someone edited it
                                      since: read it again and redo your edit. Repeating your own edit changes nothing
  flockr doc versions <channel>       every version, newest first

Notes (an agent's own memory across conversations; a person may read and edit any agent's) and channel memory (what every agent in a channel reads first)
  flockr notes [list] [--agent a] [--archived]   its notes, newest first; --agent defaults to who you act as
  flockr notes add <text> [--kind dead-end|decision|preference|fact|todo] [--tag t]... [--thread m12|806] [--key k] [--agent a]
                                      short items (500 characters at most); --key makes a retry change nothing twice
  flockr notes edit <id> [new text] [--kind k] [--tag t]... [--thread id]   an edit is a new event; --tag replaces the tags
  flockr notes archive|restore <id>   an archived note leaves your lists and prompts; safe to repeat
  flockr memory [list] --channel <c> [--archived]   what the channel remembers: decisions and facts every agent working there reads first
  flockr memory add|edit|archive|restore ...   same words as notes, with --channel <c>; anyone may add, a person changes any item, an agent only its own

Saved sessions (a worker's transcript, saved as one chunk per turn so another machine can restore it; only that agent and people read them)
  flockr sessions list [<agent>] [--thread id]    its saved sessions, most recently saved first: turns, size, fence
  flockr sessions show <agent> <session>   every chunk in turn order, the list a restore reads

Routines and watchers (off until a person turns them on; each run is a job with retries; times are UTC)
  flockr routines [list] | flockr routines show <id>   on or off, trigger, action and the last runs
  flockr routines create <name> --channel <c> (--cron '0 8 * * 1-5' | --event message.posted) --action <kind> [--per-hour n]
                                      --action post --text t | task --title t [--for member] | mention --agent a --text t | brief
                                      a schedule is minute hour day month weekday; an event routine is a watcher on that channel
  flockr routines update <id> [--name n] [--channel c] [--cron s | --event e] [--action ...] [--per-hour n]
  flockr routines on|off|delete <id>  only a person can manage routines; off skips runs already queued
  flockr routines jobs <id> [--limit n]   its runs, newest first: cause, state, attempts, result and last error
  flockr brief                        the morning brief as of now: finished in 24 hours, blocked, waiting for a person

Approval rules (allow, ask or block per action kind, board-wide or per channel; a floor no rule can lower)
  flockr rules [list] [--channel c]   every kind (post, task, mention, brief, command, spend, prod) with its verdict, floor and the rules set
  flockr rules set <kind> allow|ask|block [--channel c]   only a person; spend and prod never go below ask
  flockr rules clear <kind> [--channel c] back to the board rule or the default
  flockr rules check <kind> [--channel c] what happens if you do it here: allow, ask (ask a person first) or block

Live
  flockr tail [--since seq]           stream board events, resuming after drops
  flockr wait --thread <id> [--timeout s] return when someone else replies in a thread
  flockr wait [--channel c] [--mentions] [--since n] [--timeout s]   without a live connection: return the first event you can see
                                      that fits (in the channel, or mentioning you), or nothing after the timeout (default 25s,
                                      at most 120s); prints the cursor to pass as --since next time. Exit 2 on timeout

Any operation
  flockr api                          list every API operation
  flockr api <operationId> [--data '<json>']

Claims carry an epoch. flockr remembers it after a claim (in FC_STATE, default ~/.flockr/claims.json)
and sends it on renew, complete, reply, ask and release; --epoch overrides. A stale epoch exits 3.
Exit codes: 0 ok, 1 error, 2 nothing found or timed out, 3 conflict.`

const argv = process.argv.slice(2)
const { values, positionals } = readArgs(argv)
const baseUrl = values.url ?? envUrl
const member = values.as ?? envMember
configureClient({ baseUrl, member, key: envKey })
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

async function waitEvents(v: Values): Promise<number> {
  const timeout = seconds(v.timeout) ?? undefined
  const query = { channel: v.channel?.replace(/^#/, ""), mentions: v.mentions ? ("yes" as const) : ("no" as const), since: optionalInt(v.since, "--since"), timeout }
  const result = await run(sdk.waitForEvents({ query }))
  print(result, () => (result.timedOut ? `Timed out; next --since ${result.cursor}` : [...result.events.map(eventLine), `next --since ${result.cursor}`].join("\n")))
  return result.timedOut ? 2 : 0
}

async function tail(v: Values): Promise<number> {
  const since = optionalInt(v.since, "--since") ?? null
  const { connectLive } = sdk
  connectLive({
    baseUrl,
    key: envKey,
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
      const query = { channel: v.channel, state, assignee: v.assignee, reviewer: v.reviewer, member: v.mine ? member : undefined }
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
        plan: planOf(v.plan),
        reviewer: v.reviewer ?? null,
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
      const call = sub === "complete" ? sdk.completeTask({ path: { id }, body }) : sdk.submitForReview({ path: { id }, body: { ...body, reviewer: v.reviewer } })
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
      printTask(remember(await run(sdk.approveTask({ path: { id: idArg() }, body: { commit: v.commit } }))))
      return 0
    case "reviewer": {
      const name = need(positionals[3], "member, or none")
      printTask(await run(sdk.setTaskReviewer({ path: { id: idArg() }, body: { reviewer: name === "none" ? null : name } })))
      return 0
    }
    case "changes":
      printTask(await run(sdk.requestChanges({ path: { id: idArg() }, body: { note: v.note } })))
      return 0
    case "commit": {
      const id = idArg()
      const body = { sha: need(positionals[3], "commit sha"), message: v.message, epoch: optionalInt(v.epoch, "--epoch") }
      printTask(await run(sdk.addTaskCommit({ path: { id }, body })))
      return 0
    }
    case "handoff": {
      const id = idArg()
      const files = v.files ? v.files.split(",").map((f) => f.trim()).filter(Boolean) : []
      const body = { to: need(positionals[3], "member"), note: v.note, lastCommit: v.commit, testState: v.tests, nextSteps: v.next ?? [], files, epoch: epochFor(id, v) }
      printTask(remember(await run(sdk.handOffTask({ path: { id }, body }))))
      return 0
    }
    case "plan":
      printTask(await setTaskPlan(positionals))
      return 0
    case "give":
      printTask(await run(sdk.giveTask({ path: { id: idArg() }, body: { to: need(positionals[3], "member") } })))
      return 0
    default:
      throw new UsageError(`Unknown command flockr tasks ${sub}`)
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
        const body = { id: need(positionals[2], "channel id").replace(/^#/, ""), topic: values.topic ?? "", repo: values.repo || null, visibility: visibilityOf(values.visibility) ?? "org" }
        const channel = await run(sdk.createChannel({ body }))
        print(channel, () => channelLine(channel))
        return 0
      }
      if (positionals[1] === "set") {
        const body = { topic: values.topic, repo: values.repo === undefined ? undefined : values.repo || null, visibility: visibilityOf(values.visibility), reviewNeedsPerson: yesNoOf(values["review-needs-person"], "--review-needs-person") }
        if (Object.values(body).every((value) => value === undefined)) throw new UsageError("Give --topic, --repo, --visibility or --review-needs-person")
        const channel = await run(sdk.updateChannel({ path: { channel: need(positionals[2], "channel id").replace(/^#/, "") }, body }))
        print(channel, () => channelLine(channel))
        return 0
      }
      if (["share", "unshare", "members", "add", "remove"].some((sub) => sub === positionals[1])) return channelSharingCommand({ positionals, values, print }, positionals[1] ?? "")
      const list = await run(sdk.listChannels())
      print(list, () => list.map(channelLine).join("\n"))
      return 0
    }
    case "read": {
      const channel = need(positionals[1], "channel").replace(/^#/, "")
      const label = values.label?.[0]
      const [feed, all] = await Promise.all([run(sdk.listMessages({ path: { channel }, query: { label } })), run(sdk.listTasks({ query: { channel } }))])
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
      const result = await run(sdk.postMessage({ path: { channel: need(positionals[1], "channel").replace(/^#/, "") }, body: { text: restText(2, "text"), labels: values.label ?? [], key: values.key, blocks: blocksFrom(values) } }))
      print(result, () => `Posted ${result.message.id}${result.message.mentions.length ? `, mentioning ${result.message.mentions.join(", ")}` : ""}`)
      return 0
    }
    case "reply": {
      const id = need(positionals[1], "thread or task id").replace(/^#/, "")
      const epoch = /^\d+$/.test(id) ? epochFor(Number(id), values) : undefined
      const reply = await run(sdk.replyToThread({ path: { id }, body: { text: restText(2, "text"), epoch, labels: values.label ?? [], key: values.key, blocks: blocksFrom(values) } }))
      print(reply, () => `Replied ${reply.id} in ${id}${reply.replyTo ? `, in the sub-thread of ${reply.replyTo}` : ""}`)
      return 0
    }
    case "edit": {
      const id = need(positionals[1], "message id").replace(/^#/, "")
      const state = await run(sdk.editMessage({ path: { id }, body: { text: restText(2, "new text") } }))
      print(state, () => messageStateLine(state))
      return 0
    }
    case "label": {
      const id = need(positionals[1], "message id").replace(/^#/, "")
      const state = await run(sdk.editMessage({ path: { id }, body: { labels: positionals.slice(2) } }))
      print(state, () => messageStateLine(state))
      return 0
    }
    case "versions": {
      const history = await run(sdk.listMessageVersions({ path: { id: need(positionals[1], "message id").replace(/^#/, "") } }))
      print(history, () => versionsText(history))
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
      if (switchTo !== "on" && switchTo !== "off") throw new UsageError("Say on or off: flockr activity <thread-id> on|off")
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
    case "orgs":
      return orgsCommand({ positionals, values, print })
    case "members": {
      const list = await run(sdk.listMembers())
      print(list, () => list.map(memberLine).join("\n"))
      return 0
    }
    case "areas":
      return areasCommand({ positionals, values, print, epochFor: (id) => epochFor(id, values) })
    case "agents":
      return agentsCommand({ positionals, values, print, baseUrl })
    case "keys":
      return keysCommand({ positionals, values, print })
    case "dm":
      return dmCommand({ positionals, values, print })
    case "threads":
      return threadsCommand({ positionals, values, print })
    case "sent":
      return sentCommand({ positionals, values, print })
    case "saved":
    case "save":
    case "unsave":
      return savedCommand({ positionals, values, print })
    case "drafts":
    case "draft":
      return draftsCommand({ positionals, values, print })
    case "machines":
      return machinesCommand({ positionals, values, print })
    case "plans":
      return plansCommand({ positionals, values, print })
    case "focus":
      return focusCommand({ positionals, values, print })
    case "notes":
      return notesCommand({ positionals, values, print })
    case "memory":
      return channelMemoryCommand({ positionals, values, print })
    case "blocks":
      return blocksCommand({ positionals, values, print })
    case "doc":
      return documentCommand({ positionals, values, print })
    case "sessions":
      return sessionsCommand({ positionals, values, print })
    case "routines":
      return routinesCommand({ positionals, values, print })
    case "brief":
      return briefCommand({ positionals, values, print })
    case "rules":
      return rulesCommand({ positionals, values, print })
    case "whoami": {
      const me = await run(sdk.whoami())
      print(me, () => (me.member ? memberLine(me.member) : `${me.name} (not a member yet: flockr join ${me.name} --owner <person>)`))
      return 0
    }
    case "join": {
      const kind = memberKinds.find((k) => k === (values.kind ?? "agent"))
      if (!kind) throw new UsageError(`--kind must be one of ${memberKinds.join(", ")}`)
      const body = { name: need(positionals[1], "name"), kind, org: values.org, owner: values.owner ?? null, runsIn: values["runs-in"] ?? null }
      const joined = await run(sdk.createMember({ body }))
      print(joined, () => `Joined as ${memberLine(joined)}`)
      return 0
    }
    case "tail":
      return tail(values)
    case "wait":
      return values.thread === undefined ? waitEvents(values) : waitThread(values)
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
      throw new UsageError(`Unknown command ${command}. Run flockr help.`)
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
