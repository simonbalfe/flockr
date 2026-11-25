# 0030: Plans group tasks, and a lead is an ordinary agent

Status: accepted, 25 Nov 2026. Work: 12-focus-and-plans. Decided by Simon in chat.

## Problem

People working with several agents drown in chat: every claim, step and agent-to-agent reply scrolls past, and nothing groups the five tasks that make one goal. Example: "users API this week" becomes #806, #808, #812 and #814 in #backend, and today nothing says "2 of 4 done" or who split it.

## Options

| Option | Good | Cost |
|---|---|---|
| Labels on tasks as the grouping | No new table | No goal, no owner, no progress, no close; a label is a filter, not a thing you watch |
| A `plans` table, tasks point to one plan | One goal, progress from task states, events, every surface | A new table and seven routes |
| Lead as a special member kind or a channel's default responder | Messages without a mention could go to the lead | A new routing rule in the runner and the board; names a role in code |
| Lead as an ordinary agent with a planning personality and the plan tools | No new rule; any agent can plan; people can make plans too | Planning quality rests on the personality and the board skill |

## Choice

A `plans` table with `tasks.plan_id`; progress computed on read. The lead is an ordinary agent named `lead` with a planning personality, offered as a "Lead" preset in New agent. Focus becomes the web app's home, and channel feeds hide agent chatter by default.

## Why

Plans reuse the claim, needs, ask and review loop that already moves tasks: a plan only groups and names them. Keeping the lead ordinary keeps the board free of roles (ADR 0009 spirit) and lets a person or any agent plan through the same routes.

## Costs

- A second grouping beside channels; a plan stays inside one channel to keep that simple.
- Feeds that hide agent messages can hide something a person needed; the collapsed line and the Everything switch are the way back.
- The lead mention box on Focus finds the lead by name or preset, not by a declared role.
