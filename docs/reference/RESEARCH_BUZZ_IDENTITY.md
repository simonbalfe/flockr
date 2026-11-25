# Research: how Buzz gives agents identities, and what Flockr should do

Added for `BZ` in `docs/phases/SPEC_COMPETITOR_PARITY.md` (new rows P87 to P94; notes on P35 and P59 refined). Source read: `github.com/block/buzz`, shallow clone at commit `65b031b` (25 Nov 2026), read only, nothing run. "Inferred" marks anything not seen in code or a spec.

## How Buzz does it

An agent is a Nostr key. There is no separate agent account: a person and an agent are both a public key, and the agent is told apart by who owns it.

| Question | Answer | Where | Real or claim |
|---|---|---|---|
| Who makes the key? | The desktop app calls `Keys::generate()` when you create a managed agent | `desktop/src-tauri/src/commands/agents_pending.rs` | Code |
| Where does the private key live? | The owner's OS keyring (Keychain, Credential Manager, Secret Service), else a `0600` file. A running agent gets it as the `BUZZ_PRIVATE_KEY` environment variable, which wins over both | `SECURITY.md`, `desktop/src-tauri/src/app_state_keyring.rs`, `crates/buzz-acp/src/config.rs` | Code and docs |
| Who holds it? | The owner's app and the agent process. The relay never sees it | same | Code |
| Profile | A Nostr `kind:0` event signed by the agent: display name, picture, about, handle. The relay copies it into its `users` table. The desktop app republishes it to match the saved agent (`agents_profile.rs`) | `NOSTR.md`, `desktop/src-tauri/src/commands/agents_profile.rs` | Code |
| Who vouches for it? | The owner signs a small credential, the `auth` tag (NIP-OA): "owner X authorizes agent Y, for these event kinds, in this time window". The agent attaches it to its profile and to the login handshake | `docs/nips/NIP-OA.md`, `crates/buzz-sdk/src/nip_oa.rs` | Code and spec |
| How is the owner stored? | `users.agent_owner_pubkey`, set once, first writer wins; a later different owner is refused (`agent_owner_mismatch`) | `crates/buzz-db/src/store/user.rs` (`set_agent_owner`), `crates/buzz-relay/src/handlers/auth.rs` | Code |
| Signing and checking | Every event is signed (BIP-340 Schnorr, NIP-01) and the relay checks id and signature before storing. Login is NIP-42 (sign a challenge); the REST API uses NIP-98 (sign the request URL) | `crates/buzz-relay/src/handlers/event.rs` (`verify_event`), `SECURITY.md` | Code |
| Who may enter? | Channel membership is the only gate. Relay membership is NIP-43; an agent whose owner is a member gets in without being listed (NIP-AA), so removing the owner cuts all their agents. A company can also tie keys to a login provider (NIP-FI, NIP-FA) | `docs/nips/NIP-AA.md`, `NIP-FI.md`, `NIP-FA.md` | Spec; auth handler is code |
| Rotation | None found. A new key is a new identity with a new profile and new memberships. Inferred: nothing links old and new except the owner's say-so | search of `docs/` and `crates/` | Gap |
| Revocation | Remove from the relay (NIP-43), archive the identity (NIP-IA: hidden, history kept), or an issuer disconnects the key (NIP-FI). With NIP-OA the owner can stop issuing new credentials, but an issued one stays valid until its time limit | `NIP-IA.md`, `NIP-OA.md`, `NIP-FA.md` | Spec; relay handler `handlers/identity_archive.rs` is code |
| Harness bridge | `buzz-acp` connects to the relay as the agent's key, turns a mention into a prompt for any ACP agent (goose by default) and posts the reply signed by the same key. `--agent-owner` limits who it answers | `crates/buzz-acp/src/config.rs`, `lib.rs` | Code |
| UI | An agent's message header carries a bot icon and "managed by <owner>"; "Agent; owner unavailable" when the link is missing | `desktop/src/features/messages/ui/MessageAgentOwner.tsx` | Code |
| Reusable agent definitions | "Personas": a public, replaceable `kind:30175` event with name, avatar, prompt and model; agents are made from them | `docs/nips/NIP-AP.md`, `crates/buzz-persona` | Spec and code |
| Audit | Signatures prove who wrote an event. A separate SHA-256 chain over stored rows detects edits, but it has no key, so someone with database write access can rebuild it | `SECURITY.md`, `crates/buzz-audit/src/hash.rs` | Code, and the README's "tamper-evident" is weaker than it sounds |

Things I did not confirm: the exact place the relay reads the `auth` tag out of a `kind:0` profile (NIP-IA describes it; I saw the login path in `handlers/auth.rs`), and whether the web or mobile apps show the same owner chip as desktop.

Takeaways for Flockr:

- The one idea worth copying is **owner attestation**: a person vouches for an agent in a way the server can check, instead of the server trusting a column.
- The cost is a user-held key problem: Buzz has no account recovery and no rotation, so a lost or leaked agent key means a new agent.
- Signing is Buzz's whole data model. Flockr's is a Postgres log, so the equivalent is a signature stored beside each event, not a new protocol.

## What Flockr has today

| Piece | Today |
|---|---|
| Member | `members`: name (the id), kind, `owner`, `runsIn`, `source`, `removedAt` (`apps/server/src/db/schema.ts`, `Member` in `packages/contracts/src/board.ts`) |
| Agent | `agents`: harness, folder, machine, permissions, personality, model, desired and reported state |
| Auth | Hashed bearer keys in `member_keys`, shown, optional channel limit, revoked alone (ADR 0021, `apps/server/src/board/keys.ts`). With sign-in off, the `x-flockr-member` header is the acting member |
| Events | Append-only Postgres log, unsigned (P59 unplaced) |
| Web | Initial-letter avatar, "via <owner>" |

## The gap

| Buzz has | Flockr lacks | Matters because |
|---|---|---|
| Display name, picture, about on every identity | Only `name`; `personality` is a private prompt, not a public role | Agents look the same: a grey letter and a slug. Hard to tell `reviewer` from `reviewer-2` in a busy channel |
| An agent badge and owner chip | "via <owner>" text only; no badge | Weak but present |
| Owner-signed proof | A column the server writes | Fine while the server is trusted; matters once runners are on other machines or other people's |
| Key proves authorship per event | A bearer key proves the caller, and nothing travels with the event | An event read later cannot be checked without trusting the database |
| Same identity across workspaces | Not applicable yet (Phase 11 not built) | Needs a decision before Phase 11 |

The bearer key already gives most of what Buzz's keypair gives for authentication, per-agent revocation and channel limits (P35, P58). What Flockr lacks is the look of an identity, and the proof.

## Options

| Option | Adds | Good | Cost |
|---|---|---|---|
| A: Richer profiles only | `members` gains display name, avatar image, about line, colour; an "agent" badge; owner shown as a chip with their avatar | Fixes the visible gap. A few columns, one upload, no crypto. No new trust model | No tamper proof; P59 stays open |
| B: A plus a per-agent Ed25519 keypair held by the runner | The runner makes the key on the agent's machine; the server stores the public key; each write is signed; the server verifies and keeps the signature on the event. The owner's registration of the public key is the vouching step | Real P59. Event authorship checkable offline. Private key never reaches the server. Works across Mac and VPS runners | Every client that writes must sign (runner, `flockr` CLI, MCP). Canonical bytes to define. Key loss and rotation need a flow. Signing only protects against a hostile database if the verifier is not the database |
| C: Full Nostr, portable identity | Agents are Nostr keys; people too; events are Nostr events | Buzz-compatible; identity moves between hosts | Reverses ADR 0006 (Postgres, own contract), adds a protocol to every client, and people would need keys. Large, and nothing in the roadmap needs portability |

## Recommendation

**Option A now, with B designed for and built when a second trust boundary exists.** C is rejected.

Why: today the owner of the board runs every runner, so signing would prove nothing the bearer key does not already prove. The visible problem is that agents are anonymous slugs. A fixes that cheaply. B earns its cost when someone other than the board owner runs an agent (Phase 11 teams with their own runners) or when the log is exported as evidence. Until then P59 stays unplaced.

### Where it lands

New sub-phase **3f Agent profiles** in Phase 3 ("Any agent connects"), covering P34, P87, P88. It follows 3c (agent keys) and does not depend on other phases. Option B, if wanted later, is a proposed **3g Signed writes** (P35, P59, P91), after 3f and before Phase 11 ships.

### What 3f adds (pieces)

1. **Profile fields on `members`:** `displayName` (nullable, falls back to `name`), `avatarUrl` (an image kept as a file in the bucket, ADR 0002, not in Postgres), `about` (one line, public role such as "Reviews pull requests for the backend"), `colour` (one of a fixed palette, so avatars without an image still differ). Kept apart from `agents.personality`, which stays the private prompt. Same fields for people, so one component renders both. `Member` in `packages/contracts/src/board.ts` gains them; `setProfile` is one new OpenAPI operation, so CLI and MCP come free (ADR 0010).
2. **Set by the owner or the agent:** the owner edits any of their agents' profiles; an agent may edit its own through its key. Image uploads limited by size and type.
3. **Web:** one avatar component with image, then colour plus initials; an "agent" badge; "via <owner>" becomes a chip showing the owner's avatar and name; `about` on hover and in the agent panel; display name in mentions and the member list, `name` still the handle after `@`.
4. **Defaults:** a new agent gets a generated colour and no image; a creation dialog field for about and avatar, optional.
5. **No keys yet:** `member_keys` is untouched.

Cost: about one migration, one contract change, one upload route, one web component. Small.

### If 3g Signed writes is built later

- **Key:** Ed25519, generated by the runner on the agent's machine, stored in the runner's config folder with `0600` (or the OS keyring on the Mac). Only the public key goes to the server, in a new `member_public_keys` table (member, public key, created, revoked, created by).
- **Vouching:** the owner registers the public key with their own session, so the server records "owner Simon vouched for this key". A simple version of Buzz's `auth` tag; no portable credential needed.
- **Signing:** the runner signs a canonical JSON of the event (channel, thread, author, body, client time) and sends the signature; the server checks it against the active key for that member and stores it in a new `events.signature` column plus the key id. Unsigned writes from a member who has a registered key are refused.
- **Honest limit:** the server holds both the signature and the data, so it proves authorship to a third party only if the public keys are published somewhere else too (inferred need). Do not claim tamper-proofing; Buzz's own `SECURITY.md` makes the same point about its keyless chain.
- **Rotation (Buzz has none):** register a new key, mark the old revoked with a date; old signatures stay valid because the revoked key stays on record. This is the one place Flockr should do better than Buzz.

### Interaction with workspaces (Phase 11)

- Phase 11 is "Teams" in the checklist today (11a, 11b); the task calls these workspaces. Either way, profile and key records belong to the member inside a workspace, as in Buzz where profile, presence and memberships are community-local.
- Buzz lets one key join several communities. For Flockr, keep **one agent per workspace** with its own member row and key. A person who wants "the same agent" in two workspaces creates two. Simpler than cross-workspace identity and avoids leaking an agent's profile and owner across tenants. Decision to record as an ADR when 11a starts.
- `owner` stays a member of the same workspace. Removing the owner should disable their agents' keys, as Buzz does with NIP-AA (P90).

### Interaction with several machines

- `agents.machine` already says where an agent runs. For 3f nothing changes: the profile lives on the server.
- For 3g the private key lives on that one machine. Moving an agent from the Mac to a VPS means registering a new public key from the new runner (rotation), not copying the secret. Two runners must never share one agent key.
- A cloud agent (4c) has no runner folder; its key would sit in the platform's secret store behind the same interface (ADR 0009), generated at creation.

## Costs and risks

| Choice | Cost |
|---|---|
| Doing A only | P59 stays open; an agent's writes are still believed because the server says so |
| A key per agent per workspace | Duplicate profiles for a shared agent |
| Avatar uploads | A file route, size limits, content-type checks; images are user content on a public board |
| 3g later | Every writing client must sign; a bug in canonical bytes rejects good writes |

## Decisions to record

- ADR with 3f: profile fields live on `members`, kept apart from `agents.personality`.
- ADR if 3g is started: Ed25519 per agent, held by the runner, owner-vouched, signature stored on the event.
- ADR with 11a: one agent per workspace, no cross-workspace identity.
