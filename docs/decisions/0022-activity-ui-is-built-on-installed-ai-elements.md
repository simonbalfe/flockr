# 0022: The activity UI is built on installed AI Elements

Status: accepted, 25 Nov 2026. Decided by Simon in chat. Builds on [0015](0015-agent-activity-is-thread-entries-rendered-with-shadcn-ai-elements.md) and supersedes in part its "patterns copied in" rendering; the data model, events and reducer in 0015 stand.

## Problem

0015 rendered agent activity with patterns copied by hand from AI Elements into `apps/web/src/components/agent/` (work block, parts, diff view, permission card, working line, chat scroll), stitched from shadcn's Trace, Marker, Item and Message Scroller. Nothing ties that code to the library: upstream fixes never arrive, `shadcn diff` has nothing to compare, and every new part type is another hand-built card.

## Options

| Option | Good | Cost |
|---|---|---|
| Keep the hand-copied patterns | No new dependencies; full control | Drifts from the library; each part is our own markup to maintain |
| Install AI Elements through the shadcn CLI and restyle them by editing each file | Real components | Every edit makes `shadcn diff` noisy and updates hard to take |
| Install AI Elements unchanged, restyle through theme tokens and className props, map Flockr's entries in thin adapters | Real components, readable `shadcn diff`, one place that knows our data model | Their own dependencies (motion, use-stick-to-bottom, shiki, ansi-to-react, `ai` types); some props built for AI SDK shapes |
| Swap to another chat UI kit | | Not shadcn, not our look |

## Choice

- The `@ai-elements` registry (`https://elements.ai-sdk.dev/api/registry/{name}.json`) is listed in `apps/web/components.json`. `shadcn add @ai-elements/<name>` installed Chain of Thought, Task, Tool, Terminal, Reasoning, Plan, Queue, Code Block, Confirmation, Conversation, Shimmer, File Tree, Test Results and Stack Trace into `apps/web/src/components/ai-elements/`, plus shadcn's Card and Alert. Existing `components/ui` files were kept, not overwritten.
- They are vendor files like `components/ui`: our code rules (no comments, no casts) do not apply inside them, and they are edited only when they cannot compile or would pull in a library we refused. Two such edits, recorded in spec 4b's Notes from the build: Reasoning renders its children instead of Streamdown, and Stack Trace gets three `noUncheckedIndexedAccess` fixes.
- Colour comes off through theme tokens, not edits: inside `.ai-elements-mono` (`apps/web/src/index.css`) the palette colours the components use (green, red, yellow, blue, orange, zinc) and `--destructive` are mapped to `foreground`, `muted-foreground`, `muted` and `background`. Failure reads by shape (a crossed circle, a triangle) and by being the darker text, never by red. Layout is tuned with className props.
- `src/components/agent/` holds the adapters: `work-block.tsx` (Chain of Thought), `parts.tsx` (one AI Element per part type), `question-prompt.tsx` (Confirmation), `working-line.tsx` (Shimmer), `chat-scroll.tsx` (Conversation), `running-text.tsx` (Shimmer, plain text under reduced motion). They map `@flockr/contracts` entries and parts to props; the contracts and `applyActivityUpdates` are unchanged.
- AI SDK types: `ai` is a pinned devDependency, used only for types by Tool, Confirmation and Conversation. Adapters shape Flockr's data to those props (a part's `running`, `ok`, `error` become a tool's `input-available`, `output-available`, `output-error`).
- Not installed: Message, because it renders through Streamdown with Mermaid, KaTeX and Shiki (refused in 0015) and Flockr's message rows are not chat bubbles; Subagent, which the registry does not have (a subagent part uses Task). Diffs and code keep shadcn's `components/ui/code-block.tsx`: AI Elements' Code Block highlights with Shiki in GitHub colours, so it is installed only because Tool imports it and is never rendered.

## Why

The library is what Simon wants to build on: installed files can be compared and updated with `shadcn diff`, and a new part type is usually one more installed component and one adapter case. Restyling through tokens and classes keeps the upstream files nearly untouched, so updates stay cheap. Adapters keep the board's data model the only truth; the UI never reshapes the contracts to fit a component.

## Costs

- New dependencies, pinned and at least 14 days old: `motion` 14.12.0, `use-stick-to-bottom` 1.1.6, `ansi-to-react` 6.2.6, `shiki` 4.6.0, `@radix-ui/react-use-controllable-state` 1.3.0, and `ai` 7.0.169 (dev, types only). An override holds `hast-util-to-html` (pulled by Shiki) at 9.0.6. Shiki is tree-shaken out of the bundle; motion is not.
- The look changes a little: each part type has its library header (Tool's status badge, Reasoning's "Thought for N seconds", Plan's toggle, Stack Trace's box) rather than one uniform trace line.
- Terminal's default renderer (`ansi-to-react`) fails to load as an ES module in the production build (React error 130), so the adapter strips ANSI codes and passes its own `<pre>`; the dependency stays only because the installed file imports it.
- The colour map in `.ai-elements-mono` must grow when a newly installed component uses a palette shade it does not list; until it does, that shade shows in colour.
- Confirmation is an Alert, so a permission card is announced as an alert by screen readers.
