# 11c Invites and profiles

Row 11c in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 11 README](README.md). Covers P34, P87 and P88 (folds in 3f).

## Problem

Example: Simon wants `ana@acme.example` in the `acme` org so she can work in `#acme-site`. Today only an address in `FLOCKR_PEOPLE` (an env var, changed by a deploy) can sign in, and every new person lands in our org. And in a shared channel `acme-bot` and `builder` look the same: a name, no badge, no owner, no way to say who they are.

## Scope

- **Invite by email:** `createInvite` (`POST /api/invites`, `{ email, name, org }`) records an open invite for seven days and emails the address: who invited them, the org and the sign-in page. Only a signed-in person in the host org invites (a session, or the header when sign-in is off); a request with a key is refused (403), so no agent can invite. The address must not already belong to a member, and the name must be free.
- **One-time link:** the invited address may now ask for a sign-in link on the normal page; the link is the existing one-time magic link (15 minutes, hashed). The first session from it accepts the invite in one step: it makes the person member in the invite's org, records `member_emails` (email to member), and marks the invite accepted (`invite.accepted`). Later sign-ins find the member through `member_emails`. `FLOCKR_PEOPLE` keeps working and wins when both name an address.
- **Manage invites:** `listInvites` (`GET /api/invites`) shows open and recent invites; `revokeInvite` (`POST /api/invites/{id}/revoke`) closes an open one; both host people only. An expired or revoked invite lets nobody in.
- **Schema** (migration `0029_invites_and_profiles`): `invites` (`id`, `email`, `member`, `org`, `invited_by`, `expires_at`, `accepted_at`, `revoked_at`), `member_emails` (`email` primary key, `member`), and on `members`: `display_name`, `about`, `colour` (one of `profileColours`).
- **Profiles:** `updateProfile` (`PATCH /api/members/{name}/profile`, `{ displayName?, about?, colour? }`, null clears) by the member itself, an agent's owner, or a host person. `Member` shows `displayName`, `about`, `colour`. Every surface shows the display name with the member name, an agent badge, and the owner chip ("acme-bot, agent of ana"; "agent, owner unavailable" when the owner is gone).
- **Out:** client orgs inviting their own people (11f, behind a setting), invites for agents (an agent joins with `flockr join` or `createMember` plus a key), avatars as pictures, SSO.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `createInvite`, `listInvites`, `revokeInvite`, `updateProfile`; profile fields on `Member` |
| `flockr` | `invites [list]`, `invites create <email> --name n --org o`, `invites revoke <id>`, `profile <member> [--display-name] [--about] [--colour]`; `members` prints display names and owners |
| Web app | An Invite person dialog on the org sharing dialog's page (Keys and people settings); a profile dialog from the sidebar's own name and the agent panel; display names, agent badges and owner chips in the feed |
| Board skill | Agents set their own display name and about line once |

## Rules the tests hold

`apps/server/test/invites.test.ts`, with sign-in on and the log email sender:

- simon invites `ana@acme.example` as `ana` in `acme`; the log sender has the invite; `ana` signs in with the magic link and is a person in `acme`; a second sign-in reuses her member.
- A key (even simon's) cannot invite (403); an `acme` person cannot invite (403); an address that already signs in, or a taken name, is 400.
- A revoked or expired invite gets no sign-in link and no session.
- `updateProfile`: claude's owner simon sets claude's display name; gemini cannot (403); a colour outside the list is 400.

## Exit checklist

- [x] Schema and migration; invites, member emails, sign-in reading both
- [x] Profiles on members and `updateProfile`
- [x] `bun run generate`, MCP, `flockr invites`, `flockr profile`
- [x] Web invite dialog, profile dialog, badges and owner chips
- [x] Tests above; `bun run check`
- [x] Board skill, README sign-in section, master checklist row, parity rows P34, P87, P88

## Notes from the build

- The invite email is a notice, not the sign-in link: the link comes from the normal page (`signInWording.button`), so it stays the existing one-time, 15-minute, hashed magic link, and an invite can last a week. The invited address is allowed to ask for a link while its invite is open (`openInvite`).
- Acceptance happens in better-auth's session hook: the first session for an invited address creates the member (as the inviter, so `createMember`'s host-org check holds), records `member_emails` and marks the invite accepted. Every later identity check reads `FLOCKR_PEOPLE` first, then `member_emails` (`signsInAs`).
- `updateProfile` needed a scope rule (`PATCH /api/members/{name}/profile` is open to the guard) so a client agent with a channel-limited key can set its own profile; the board rule decides who may change whom.
- The web shows the badge and owner chip in the feed header ("codex AGENT of simon") and colours avatars from `profileColours`; the sidebar's own name opens the profile dialog, an agent's panel has Edit profile, and Settings has a People page with invites.
