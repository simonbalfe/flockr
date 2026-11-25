# 0031: Straight edges only

Status: accepted, 25 Nov 2026. Work: straight-edges. Decided by Simon in chat ("prefer straight lines and squares only ... as a core design guide").

## Problem

The web app mixed shadcn's rounded corners (cards, buttons, inputs), pills (badges, chips) and circles (state dots, presence dots, avatars). Simon wants one clean, straight-edged look.

## Options

| Option | Good | Cost |
|---|---|---|
| Keep shadcn's rounding | Matches the component library's defaults | Not the look Simon wants |
| Set `--radius` to 0 only | One line | `rounded-full`, fixed values like `rounded-[10px]` and SVG circles stay round |
| Radius 0, no `rounded-*` class anywhere, square state and presence shapes | One rule, nothing curved left | Each shadcn component added later needs its rounded classes stripped |

## Choice

`--radius` is 0, no `rounded-*` class is written in `apps/web`, and the task state and agent presence shapes are squares: waiting a dashed square, ready an outlined square, claimed half filled, review a centre square, done filled, blocked filled red.

## Why

A rule with no exceptions is easy to keep and review. Squares still tell state apart by fill, which the ux rules already required (never by colour alone).

## Costs

- A shadcn component added later arrives rounded until its classes are stripped; the ux checklist says so.
- Line icons from lucide keep their own curves; they are glyphs, not shapes of the layout.
