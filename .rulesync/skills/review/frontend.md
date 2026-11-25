# Frontend review checklist

Scope: `apps/web/src` (routes, components, the data layer). Out of scope: the generated shadcn files in `apps/web/src/components/ui/`, unless the app uses one wrongly.

A frontend review looks at the running app, not only the code. Tests miss a label that reads as an internal id, a task state shown only by colour, or an empty state that is false while an agent is working.

## Run it in a browser

1. **Stack:** start it as the `do-verify` skill says, and note its port (`http://localhost:5173`).
2. **Act as a person would,** with the seeded board. Make any data you need through the API or `flockr`, never by hand-written rows.
3. **For each route the scope touches,** at 1280×800 and 390×844, in light and in dark (the theme follows the OS):
   - take a screenshot and look at it; load the page fresh after a hot reload
   - read the console: key, hydration and network warnings are bugs
   - measure sideways overflow: `document.documentElement.scrollWidth - visualViewport.width` is 0
   - read the accessibility tree: one `h1`, labels on inputs, named buttons
   - walk the states: loading, empty, one, many, an unknown channel or task id, the live socket dropping and coming back
4. **Keyboard:** every action reachable with Tab, Enter and Escape, focus visible, ⌘K opens the switcher from anywhere.

Do the interactive checks with the Chrome DevTools MCP (the global `chrome-devtools`, headless and isolated), never Claude in Chrome.

## Checklist

- **shadcn, one way:**
  - every primitive comes from `apps/web/src/components/ui/`, untouched; the app's own compositions (the state dot, the page header, the panel frame) are built from those parts and live once
  - a second hand-made button, badge, card, dialog, empty state or tooltip is a finding
  - a link that looks like a button uses `buttonVariants` (or `asChild`)
- **Tokens and the monochrome look:** colours only from the theme tokens in `apps/web/src/index.css` (shadcn zinc), never raw hex and never a Tailwind palette colour (`text-muted-foreground`, not `text-zinc-400`). No accent colour. Red (`destructive`) means only two things: a blocked task and a lease running low; nothing else is red. Task state is told by the dot's shape (`apps/web/src/components/state-dot.tsx`), never by colour alone. Measure text contrast at AA (4.5:1) in both themes.
- **States:**
  - loading, zero, one and many each look right
  - an empty state says what will appear and how ("No tasks yet. Write @claude and a request to make one."), and stays true when a filter is on
  - an error shows our own message from the failure's `kind`, never "Failed to fetch" or a raw status, with a way to try again
  - a failed load keeps the frame: the sidebar and header stay, and the route's error view has a heading and Try again
- **Live updates:**
  - each event from the socket patches the query cache, so the screen changes without refetching everything
  - a dropped socket reconnects with "after N" and shows a quiet "Reconnecting" state, never a stale screen that looks live
  - an optimistic change is rolled back with a message when the server refuses it (a stale fence, a task someone else claimed)
- **Data flow:**
  - screens reach data only through the hooks over the generated client (`packages/client`); no hand-written `fetch` to a route, and no screen touching a store directly
  - types follow [typescript.md](typescript.md), Derived types
  - no fetching in `useEffect` where a router loader or a query hook does it
  - search params (`?thread=`, `?task=`, `?agent=`) are validated with a schema and a fallback, so a hand-edited URL shows the default, never an error
  - names and labels come from the API and the contracts label maps, never re-derived from a raw code on the page
- **Actions:** a control that changes state cannot fire twice from a double click; a button the person may not use is hidden or disabled with its reason, and the API still refuses it.
- **Long names:** an 80-character channel, task or agent name at both widths truncates with a `title`, in the sidebar, the feed, the kanban and the thread header.
- **Layout:** no sideways page scroll at 390 px; wide content scrolls inside its own frame; `min-w-0` on flex children with text; the thread panel is full screen on a phone with a clear way back.
- **Accessibility:** one `h1` in every state, headings in order, every input labelled, icon-only buttons named, focus visible, live changes (a new message, a claim) announced through a polite live region, and the state dot has an accessible name ("Claimed by claude").
- **Time:** relative times ("11 min left", "2 min ago") come from one module and tick without a re-render storm; absolute times show their time zone.
- **React:** stable keys, nothing reading `window` or `document` at module scope, no state that duplicates the URL or the query cache.
- **Forms and the composer:** an async handler resets its busy state in `finally` and shows the failure's message; Enter sends and Shift+Enter breaks a line; a draft survives switching channels.
- **Copy:**
  - plain words, one next step per view
  - every state a person sees goes through one label map keyed by the list (`Record<TaskState, string>`, never `Record<string, string>`), so the same thing has the same name on every page and in `flockr`
  - no internal words on screen: sub-phase ids, ADR numbers, table names, fence numbers
  - no agent-facing text on a page: a hint written for an agent stays in the API, MCP and board skill text
- **Personal data:** screenshots kept as evidence show only the seed and invented names.

## Fix and verify (step 4 of the skill)

Reproduce each finding in the browser before fixing it (route, viewport, theme, steps), and label what does not reproduce PLAUSIBLE. After a fix, re-check with a fresh load and a screenshot. Record each deferred item with the trigger that brings it back, and each accepted one with the reason.

The review file adds a "Screens checked" list: route × viewport × theme.

## Learned from reviews

Each line is a class of mistake an earlier review caught, added by that review's run (step 5 of the skill), with the review file it came from. Check every line here as well as the checks above.

- A dialog or sheet opened from a button gives focus back to that button when it closes; open each with the keyboard, then Esc (carried over from maestro-service's frontend review)
- A dialog fits a 390 screen with a margin and scrolls inside itself (carried over from maestro-service's frontend review)
- A query never retries a 4xx or a 429, so an unknown id reaches its Not found at once (carried over from maestro-service's frontend review)
