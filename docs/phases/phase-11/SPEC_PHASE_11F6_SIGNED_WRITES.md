# 11f spec only: Signed writes and owner attestation

Part of [11f Governance](SPEC_PHASE_11F_GOVERNANCE.md). **Spec only, not built.** Competitor rows P35, P59, P90, P91 (Buzz). Research: [RESEARCH_BUZZ_IDENTITY](../../reference/RESEARCH_BUZZ_IDENTITY.md), its option B and "If 3g Signed writes is built later".

## Problem

Example: Acme disputes that `acme-bot` approved task #812 at commit `a1b2c3d`. Today the only proof is our own event row, written by our server from a bearer key. Acme has to trust us as the operator; so does anyone reading an exported log. That is fine while every client trusts us (Phase 11 decision), and stops being fine when a client runs its own runner, or when the log is evidence.

## What it would add

- **A key pair per agent:** Ed25519, made where the agent runs (the runner's config folder at `0600` or the OS keyring; the platform secret store for a cloud agent). Only the public key reaches the board, in `member_public_keys` (member, key, made, revoked, registered by). Two runners never share one agent key; moving machines is a new key.
- **Owner attestation (P90, P91):** the owner registers the public key with their own session, so the board records "ana vouched for this key for acme-bot". Removing the owner, or the owner revoking the vouch, disables the key, as Buzz's NIP-AA does. A key is limited by event kind and time if the owner says so (P91's scope).
- **Signed writes (P35, P59):** a writing client signs the canonical JSON of the event it asks for (channel, thread, author, kind, body or block, client time, a request key) and sends the signature beside the bearer key. The board verifies it against the member's live key and stores `events.signature` and the key id. A member with a registered key whose write comes unsigned is refused.
- **Rotation, better than Buzz:** a new key is registered and the old one revoked with a date; old signatures stay checkable because revoked keys stay on record.
- **The honest limit:** the board holds both the data and the signatures, so they prove authorship to a third party only if the public keys are also published elsewhere (the client's own repo, a signed manifest). Do not call it tamper-proof. A keyless hash chain (Buzz's audit log) only shows edits to single rows; anyone with database write access can rebuild it.

## The cheaper option: sign only what is high-stakes

Most events are chat. The ones a dispute is about are few:

| Event | Why it matters |
|---|---|
| A review approval or changes requested (13a) | Says whose verdict let work through, at which commit |
| A spending or prod approval (a `job_approvals` answer, a question that gates a spend) | Says who let money or prod change |
| A merge or a hand-off record (13c) | Says who moved work across the org line |

Signing only these keeps the cost to three write paths (`approveTask`, `requestChanges`, the approval answer, the hand-off block) instead of every client and every write. Messages stay bearer-only. It needs the same key pair and attestation, but no canonical form for messages, edits, reactions or files, and a runner that never approves never signs. **Recommended first step if this is ever built.**

## Why not now

- Every client we run today is ours, and OAuth tokens (piece 4) are minted by the board; a signature would prove nothing the key does not.
- Every writing client (runner, `flockr`, MCP, the web app for people) would need to sign, and the MCP clients we connect cannot sign without a wrapper.
- A bug in the canonical bytes refuses good writes.

## When to build

When a client runs its own runner against our board, or when Simon needs an exported log to stand as evidence. Then: an ADR (Ed25519 per agent, held where it runs, owner-vouched, signature on the event), the high-stakes subset first, every write later only if asked.

## If built, the rules its tests would hold

- An approval from `acme-bot` with a registered key and no signature is refused; with a signature from a revoked key it is refused; with a good signature it is stored and verifiable offline from the event and the public key.
- The owner revoking the vouch refuses `acme-bot`'s next signed write at once.
- A key registered by anyone but the agent's owner is refused.
- Old approvals stay verifiable after rotation.
