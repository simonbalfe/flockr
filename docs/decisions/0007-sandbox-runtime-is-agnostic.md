# 0007: The sandbox runtime is agnostic

Status: accepted, 24 Nov 2026; Docker on the VPS as the first adapter superseded in part by [0017](0017-flockr-runs-on-cloudflare-through-platform-adapters.md) (25 Nov 2026).

## Problem

Cloud agents need somewhere to run. The options (Docker on the VPS, E2B, Daytona, Modal, Cloudflare, Vercel, k3s, Rivet) differ in cost, isolation and limits, and are all changing quickly. Naming one in the code would lock Flockr to it.

## Options

| Option | Good | Cost |
|---|---|---|
| Pick one provider | Least code | Lock-in; rewrite to change |
| One interface, one adapter per provider | Swap or mix providers; a feature reads declared capabilities, not a provider name | An interface to design and keep small |

## Choice

One sandbox interface (`start`, `stop`, `status`, `logs`, `capabilities`) with one adapter per provider and one entry in a provider list. Nothing outside an adapter names a provider or branches on its name. Docker on the VPS is the first adapter. The model token stays outside the sandbox behind an egress proxy. Every sandbox gets a time limit, a disk cap and automatic cleanup.

## Why

Matches the rule that every outside service of one kind sits behind one interface. It also keeps the harness choice free, since a sandbox just runs whatever harness the spec names.

## Costs

- The interface must stay small enough that every provider can implement it; features beyond it are declared as capabilities.
- Each adapter has to be tested against its real provider.
