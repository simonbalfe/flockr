---
name: do-dashboard-ux
description: How to design, prototype and build a Flockr web app screen to the dashboard rules (after Apple's Human Interface Guidelines and modern apps such as Linear, Vercel and Slack; shadcn zinc, monochrome), which live in the ux checklist. Use whenever you design, prototype or change a screen, its navigation, layout, toolbar or copy, or when Simon says a screen "looks bad", "is cooked" or "shows too much".
targets: ["*"]
---

# Flockr UX

How to change a web app screen. The rules it must meet are the Dashboard rules in the ux checklist (`.rulesync/skills/review/ux.md`): principles, colour and state, Slack habits, navigation, layout, toolbars and controls, copy. Read them before you start.

1. **Read the rules** in the ux checklist, Dashboard rules, and the screen as it is today. The clickable prototype `docs/reference/agent-board.html` shows the intended feel.
2. **Prototype** a non-trivial change first as one HTML file in the session scratchpad with Tailwind (CDN) and the same zinc tokens, open it, and let Simon click it before building.
3. **Copy:** a page, panel, dialog or section title stands alone. Write no sentence under it saying what the screen is or how it works. Keep only text a person acts on: an empty state's next step, a field's error, a block reason, a limit, or a confirm's consequence before something destructive (ux checklist, Copy).
4. **Build** with the shadcn/ui components in `apps/web/src/components/ui/` and the theme tokens in `apps/web/src/index.css`: no one-off colours and no Tailwind palette colours (`text-muted-foreground`, not `text-zinc-400`). Monochrome: no accent colour; the primary action is the solid foreground button. Red (`destructive`) only for a blocked task and a lease running low. Task state by the dot's shape (`apps/web/src/components/state-dot.tsx`), never by colour alone.
5. **Every action is a route first** (ADR 0003): a new control calls a hook over the generated client, and the same action exists in `flockr` and MCP. A screen never does what an agent cannot.
6. **Check the live screen** with the Chrome DevTools MCP (the global `chrome-devtools`, headless and isolated), never Claude in Chrome, against each Dashboard rules line the change touched, at 2,560, 1,440 and 390 px, in light and dark.

## Principles (after Refactoring UI, Adam Wathan and Steve Schoger)

Judgment, in our own words, each with a before and after on Flockr's screens.

1. **Start from the feature, not the layout.** Decide what the person does on the screen (answer claude's question, approve #812), then build only that. Before: a Waiting for you page that began as a full table with every column. After: one card per question with its two buttons.
2. **You do not have to fill the screen.** Give content the width it needs. A message feed reads well at 600 to 720 px; stretched to 2,560 px the eye cannot travel from a name to its reply. Cap it, or pair it with the right panel. Before: a feed line ran 2,000 px wide. After: a 720 px column with the thread panel beside it.
3. **Hierarchy through weight and colour, not only size.** Make the one thing that matters heavier or darker and the rest lighter. Before: a task row's title, id, holder and lease all the same grey. After: the title in the main text colour at medium weight; id, holder and lease small and muted.
4. **Emphasise by de-emphasising.** When something does not stand out, quiet its neighbours. Before: Claim, Release, Block and Mark done as four outline buttons in the thread header. After: the one action for the state is solid, the rest sit in `⋯`.
5. **Labels are a last resort.** If the value explains itself, drop its label: "11 min left", not "Lease remaining: 11 min"; "claude via simon", not "Agent: claude, Owner: simon".
6. **More space between groups than within them.** Before: kanban columns as close to each other as cards inside a column. After: 24 px between columns, 8 px between cards.
7. **One spacing scale and one type scale.** Use only the Tailwind steps already in use (4, 8, 12, 16, 24, 32, 48) and the sizes `text-xs`, `text-sm`, `text-base`, `text-xl`. Never a one-off 13 px or 18 px. Measure, never eyeball.
8. **Fewer borders.** Separate with space, a slightly different background or a soft shadow before adding a line. Before: every message in the feed had a divider. After: space between messages, a divider only before a new day.
9. **Keep an action next to what it acts on.** A button more than about 200 px from its row's name is lost. Before: a task row's Claim button at the far right of a 2,560 px kanban. After: the card holds its title and its one action together.
10. **Design the empty state.** Say what is missing and offer the next step. Before: an empty Waiting for you. After: "Nothing needs you. Agents ask here when they are stuck."
11. **Balance weight and contrast.** Soften a heavy element by lowering its contrast; strengthen a light one by raising it. Before: a thin 1 px ring for the ready dot beside bold text. After: a 1.5 px ring at the same size as the filled dots.
12. **Colour carries one meaning.** In a monochrome app, the one colour that remains is a signal. Before: red for a failed check, a delete button and a blocked task. After: red only for blocked and low lease; delete is red only inside its confirm.

Also: a screen is walked at 2,560, 1,440 and 390 px. If the content looks lost or its parts drift apart at 2,560, the fix is a width cap or a side panel, never more columns of empty space.
