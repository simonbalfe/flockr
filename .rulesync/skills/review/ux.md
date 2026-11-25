# UX review checklist

Scope: one flow through the web app, named as the review's scope: `channels` (find a channel, read it, post), `thread` (open a task's thread, read its header, act on it), `tasks` (the kanban for one channel or all), `waiting` (Waiting for you: answer a question card, approve or ask for changes), `mentions` (`@claude <text>` makes a task, ⌘K jumps anywhere), `phone` (any of these at phone width), or a sub-phase id, which means the flows that sub-phase added.

Why a separate review: the frontend review checks that pages work (states, overflow, accessibility). It does not check that a newcomer can find their way. A page can pass every frontend check and still leave a person unsure whether claude is working on #812 or stuck, or whether their "Run it" answer was sent.

## Who runs it

- A fresh session in its own Herdr tab (step 3 of the skill), never the one that built the screen.
- Judge every screen against the Dashboard rules below. Each finding names the rule it breaks, such as "Toolbars and controls: at most three controls" or "Copy: empty states say the next step". A finding that breaks no rule says why a newcomer is still stuck.
- Local stack only, invented names only. A control that would spend money or touch prod is observed up to the click, not clicked.

## Dashboard rules

After Apple's Human Interface Guidelines and modern SaaS apps (Linear, Vercel, Slack). Judgment rules, not a script: every web app change meets them (the `do-dashboard-ux` skill says how), and a UX review names the line a screen breaks.

- **Principles:**
  - Clarity: each screen answers one question, and the heading names it (#backend answers "what is happening in backend?"; Waiting for you answers "what needs me?")
  - Deference: chrome stays quiet so the messages and tasks lead; monochrome zinc, no accent colour, neutral buttons; the one primary action is the solid foreground button
  - Hierarchy: heading, then toolbar, then content, each on its own row
  - Consistency: the same thing looks and works the same everywhere (a task row in the feed, the kanban and Waiting for you shows the same dot, id, title and holder), and each concept has one icon wherever it appears
  - Facts said once: each fact appears once on a screen (a task's state in the thread header is not repeated in a card below it)
  - Progressive disclosure: the summary in the list, the detail one click away in the right panel
  - Direct feedback: every wait shows a loading state and nothing goes blank; a person's action shows at once, and a refusal rolls it back with a message
  - A loading state shows only on the first load, never beside data already on screen: a background refetch or a live event shows nothing but the change itself
  - a page never blocks on data its frame does not need: the sidebar, header and layout draw at once, and each list loads behind its own skeleton
  - in-app navigation never shows a blank window: the current page stays until the next is ready
- **Colour and state (Flockr's own look):**
  - shadcn zinc, monochrome; no accent colours anywhere
  - red only for a blocked task and a lease running low; nothing else is red, so red always means "look here"
  - straight edges only (Simon, 25 Nov 2026, ADR 0031): no rounded corners, pills or circles; `--radius` is 0 and no `rounded-*` class is written; avatars, badges, buttons, cards, inputs and dots are squares or rectangles
  - task state is told by the square's fill: waiting a dashed square, ready an outlined square, claimed a half-filled square, review a square with a centre square, done a filled square, blocked a filled red square (`apps/web/src/components/state-dot.tsx`); never by colour alone
  - agent presence is a small square beside the name (working, idle, blocked), the same three everywhere
- **Slack habits, kept in the same places** (architecture guide, Design choice 10):
  - sidebar: channels, then agents with their live dot, then people
  - a thread or task opens in the right panel, with its holder, lease, needs, spec, commit and actions in the header
  - "Waiting for you" holds questions from agents and finished work to review, with a count in the sidebar
  - "claude is working on #803, 11 min left" sits under the message box, like "is typing"
  - ⌘K jumps to any channel, task or agent
  - a question card is buttons in the message ("Run it / Not now"), answered in one tap
- **Refactoring UI tips, most important first** (Adam Wathan and Steve Schoger, boiled down; each is a finding when a screen breaks it; the `do-dashboard-ux` skill has before and after for the top ones):
  1. Hierarchy is the biggest lever: decide the one thing that matters on the screen and make everything else quieter
  2. Emphasise by de-emphasising: when something does not stand out, soften its competitors instead of adding more to it
  3. Weight and colour before size: bolder for the main thing, a softer colour for support text; two weights and three text shades are enough; never a weight under 400 for small text
  4. Do not fill the screen: give content the width it needs (a 600 to 720 px column for a message feed is fine at 2,560 px), cap it, or split it into columns or a side panel
  5. More space around a group than inside it, so grouping is seen without borders
  6. One scale for spacing, type, shadows, radius and colours, chosen from a short list, never a one-off value
  7. Labels are a last resort: "11 min left" beats "Lease: 11 min"; where one is needed, make it small and soft, and make the data the loud part
  8. Actions form a pyramid: one solid primary, outline secondaries, link-style tertiaries; a destructive action is only big and red inside its confirm
  9. Fewer borders: space, a background shade or a soft shadow first
  10. Design every empty state: what is missing and the next step; hide filters and tabs that do nothing yet
  11. Never rely on colour alone: pair it with a shape, an icon or a word
  12. Balance weight and contrast: soften a heavy icon, thicken a faint line
  13. Section titles are labels, not headlines: small, the content leads
  14. Text: 45 to 75 characters a line, left aligned, long text never centred, numbers right aligned with tabular figures
  15. Depth tells importance: a small shadow for a button, medium for a menu, large for a dialog
  16. Not every link needs colour: in a screen of links use weight or a darker shade and underline on hover
  17. Avatars and icons at their drawn size, never scaled far from it
  18. Build the smallest useful version first; show nothing the product cannot do yet
- **Navigation:**
  - One menu: the sidebar is the only navigation; never a second tab row for pages. A channel's Messages and Tasks are one control in its header, not two menus
  - The heading is the page: it never repeats what the sidebar's selected item already says
  - The right panel is driven by search params (`?thread=`, `?task=`, `?agent=`), so back and forward and a pasted link work, and Escape closes it
  - In-app links use the router `Link`, never `<a href>`, so the app never reloads
- **Layout:**
  - give content the width it needs, not the width there is: the kanban uses the full width; a message feed and a form use a readable column, and the spare width holds the right panel or nothing
  - a row's name and its action stay close together: never more than about 720 px apart at 2,560 px
  - rows are at least 44 px tall (Apple HIG) where they are tapped
  - a screen shows one main thing; wide content scrolls inside its own frame and never pushes the page wider
  - spacing is measured, not eyeballed: one gap between blocks, one padding per card, one height per row in a list, a dot or badge centred on its row within 2 px
  - clean surfaces: no coloured stripe on one edge of a card or row to mark it special (a soft fill and a small label instead); no dashed, dotted or double border except the waiting dot's own ring
  - only the active item has the selected background in the sidebar
  - anything to copy (a command, a key) is one code block labelled with where it goes; a secret is shown once and never again
- **Toolbars and controls:**
  - at most three controls in a page toolbar
  - a toggle is one control with a menu, never a row of pill buttons
  - a button's label does not change between views; if the action differs, the menu says how
  - a task's actions follow its state (Claim on ready, Mark done and Release on claimed, Approve and Ask for changes on review), one primary at a time, the rest in a `⋯` menu
  - a list's filters sit at the top of the list they filter, live in the URL, and Clear appears once one is set
- **Copy:**
  - plain words, sentence case, no jargon: "Waiting for you", not "Pending human-in-the-loop items"
  - empty states say what is missing and the next step: "No tasks yet. Write @claude and a request to make one."
  - a title stands alone: no sentence under a page, panel, dialog or section title saying what it is or how it works; keep only text a person acts on (an empty state's next step, a field's error, a block reason, a limit, the consequence in a confirm)
  - errors say what happened and what to do: "Someone else claimed #812 first. Refresh to see who."
  - no machine text on screen: no fence number, uuid, raw state slug or server error text

## Objectives

1. **User stories.** Write 5 to 8, each as "As a `<person>`, I want `<goal>` so that `<outcome>`", with a start and an end. The people: a person on a desktop, the same person on a phone, a teammate who joined today, and a returning person who comes back a day later to see what moved. Example: "As Simon on my phone, I want to answer claude's question about the users migration so that #808 can run. Start: the app's home. End: the answer shows in the thread and #808 is claimed."
2. **Reach each goal** from the app's home, never by typing a URL. Record the path (the labels clicked, in order), the number of clicks and every wrong turn. Verdict per story:

   | Verdict | Means |
   |---|---|
   | Easy | First try, no wrong turn |
   | Findable with effort | One or two wrong turns, or a guess that happened to work |
   | Hard | Found only by trying most of the screen |
   | Not reachable | No path without typing a URL or knowing the product |

3. **Friction.** Repeated work, waits with no feedback, the next step not where it was expected, things to remember across screens (a task id copied from one place to paste in another), confirmations that protect nothing.
4. **Confusion.** Clicks whose result is unclear, mixed signals (a task shown claimed in the feed and ready in the kanban, "working" beside an agent with no task), and terms a newcomer meets without explanation: lease, claim, needs, review, holder. Quote the words on screen.
5. **Clarity per step.**
   - Orientation: the person can tell where they are from the heading and the selected sidebar item.
   - One obvious next action.
   - Related things grouped, unrelated things apart.
   - An action that spends money or changes prod says so before the click.
   - Phone parity: every step a person can take at 1440 wide they can take at 390.

## Method

1. **Stack:** the `do-verify` skill. Never a deployed board.
2. **Data:** make every state the stories meet through the API or `flockr`: an empty channel, the example chain #806, #808, #812 in each state, a blocked task, a lease about to run out, a question card, an 80-character task title. Invented names only.
3. **Walk it** with the Chrome DevTools MCP driving headless Chrome with an isolated profile against `http://localhost:5173`, never Claude in Chrome:
   - 2560×1440, 1440×900, then 390×844, in light and in dark; content that looks lost or drifting apart at 2,560 is a finding
   - a screenshot at each step, kept in `.evidence/<slug>/ux/`
   - the console and failed network requests read at each step; an error is a finding for the frontend review, noted here in one line
   - while you walk, let an agent act through `flockr` or the API (claim, reply, complete) and check the screen follows live
4. **Reproduce** each suspected finding a second time from a fresh load before writing it down. What does not reproduce is dropped, or labelled PLAUSIBLE.

## Report

The reviewer writes `docs/reviews/REVIEW_UX_<SCOPE>_<YYYY-MM-DD>.md` in this shape, every Outcome `open` and every "after" verdict blank:

```markdown
# Review: ux · <scope> · <date>

- **User stories:** <count>, people: <desktop, phone, new teammate, returning>
- **Flows:** <the flows walked>
- **Method:** independent reviewer in its own Herdr session; local stack; 2560×1440, 1440×900 and 390×844, light and dark; findings reproduced; author re-verified
- **Verdict:** pass | pass with deferrals | fail

## User stories and paths
| Story | Start to end | Path | Clicks | Verdict before | Verdict after |
|---|---|---|---|---|---|

## Friction
## Confusion
<each item quotes the words on screen>

## Findings
| # | Severity | Where | What a new user meets (verified) | Outcome |
|---|---|---|---|---|

## What works
## Screens checked
<route × viewport × theme>
```

- **Findings:** up to 25, most important first. Severity is `blocker` (a story cannot be finished), `confusing` (finished only with a wrong turn or a guess) or `polish`. Where is the route and the viewport. The finding gives the words on screen, why they confuse, the Dashboard rules line broken, and a concrete fix with `file:line`.
- **What works:** the steps that were easy, so a fix does not undo them.

## Fix and verify (step 4 of the skill)

1. **Reproduce** each finding before fixing it. Reject what does not reproduce, and say so in its Outcome.
2. **Fix** with the shadcn components and the Dashboard rules. A label two surfaces show changes in its label map in `packages/contracts`, not on the page.
3. **Re-walk** every story at all three viewports: a screenshot per step, no sideways scroll (`document.documentElement.scrollWidth - visualViewport.width` is 0), no console errors. Fill in "Verdict after".
4. `bun run check` green, then ship by the Workflow steps in `CLAUDE.md`, with the Outcomes set in the same change.

## Learned from reviews

Each line is a class of mistake an earlier review caught, added by that review's run (step 5 of the skill), with the review file it came from. Check every line here as well as the checks above. The first lines were carried over from maestro-service's UX reviews because they hold in any app.

- A copy block or code inside a dialog wraps or scrolls inside it, and its buttons stay inside it at 390 wide (carried over)
- A run that failed before it ever succeeded offers Try again on the same screen, never only a red line (carried over)
- Destructive actions confirm the same way everywhere, naming what breaks, and a confirm's title and button use the words of the button that opened it (carried over)
- Placeholders and examples use example.com and invented names (carried over)
- A record that failed says on its own page why and the next step (carried over)
- An action approved in one click ends with a message naming what changed, never a dialog that just closes (carried over)
- A value read from an outside system is shown in sentence case, never as its raw enum (carried over)
- Stored markdown (a message, a spec, a note) is rendered, never shown with its marks (carried over)
- A record a person can add in the web app they can also edit there when the API can (carried over)
- An action that cannot run yet is hidden or disabled with its reason beside it, never a dialog that opens only to say so (carried over)
- A held or waiting queue is counted where a returning person looks first, with a link to it (carried over)
- One place per concept: a feature has one screen and one menu entry, and other screens link to it instead of repeating a part of it (carried over)
- At 390 a list row keeps its name and its main action in view; detail moves to the panel (carried over)
