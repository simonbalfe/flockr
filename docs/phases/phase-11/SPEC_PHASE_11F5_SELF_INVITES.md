# 11f piece 5: Client self-invites

Part of [11f Governance](SPEC_PHASE_11F_GOVERNANCE.md). From the Phase 11 decision "Who invites? Only our org at first. A client org invites its own people and agents later, behind a setting".

## Problem

Example: Acme hires `bea` and wants her in `#acme-site`. Before this piece `ana` had to ask Simon, who invited `bea@example.com` into `acme` himself. Every new client person cost us a step.

## Scope

- **The owner:** a client org has at most one owner, a person in that org, named by a host-org person (`PATCH /api/orgs/{id}` with `owner`, or `null` to clear). The host org has no owner.
- **The setting:** `selfInvites` on a client org, **off by default**, set only by a host-org person. The host org refuses it: its people always invite.
- **What the owner may do with it on:** invite people by email into their own org only, list only their org's invites, and revoke only those. Never into the host org or another client org, never by key. Other people in the org cannot invite. The invitee signs in with the usual one-time link and becomes a person in that org, seeing only what `canSee` shows them: nothing until a host person adds them to a shared channel.
- **Turning it off:** stops the owner at once and revokes every open invite that people of that org sent (`invite.revoked` with cause `self-invites-off`); invites our own people sent into that org stay open.
- **Out:** client owners inviting or making agents, making keys for their agents, adding their people to shared channels (P35-style self-management), several owners per org.

## Schema

Migration `0035_self_invites`: `orgs.self_invites` (boolean, default false) and `orgs.owner` (a member name, checked in code). Events `org.updated` with what changed.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `updateOrg` (`PATCH /api/orgs/{id}`); `Org` gains `selfInvites` and `owner`; `createInvite`, `listInvites`, `revokeInvite` open to an owner with the setting on |
| `flockr` | `flockr orgs set <id> [--name n] [--owner person\|none] [--self-invites on\|off]`; `flockr orgs` shows both |
| Web app | Settings, People: a Client orgs section for host people (owner select, Owner invites switch); Invite person shows for the owner of an org with it on, limited to their org |
| Docs | Phase 11 README decision row, connection guide |

## Rules the tests hold

`apps/server/test/governance.test.ts`, client self-invites:

- Off by default: `ana` cannot invite into `acme`, even once she is its owner.
- Only a host person changes an org; the owner must be a person in that org (`gus` from `globex` and the agent `acme-bot` are 400); the host org refuses the setting; a repeat change writes one event.
- With it on, `ana` invites `bea` into `acme`, and is refused `home` and `globex`; `ben` (in `acme`, not the owner), `gus` and `ana`'s key are refused; she lists only `acme`'s invites and gets 404 on ours; Simon sees both. `bea` signs in into `acme`, is refused `#backend`, and cannot invite.
- Turning it off refuses `ana` again, revokes `bea`'s open invite (her sign-in link is never sent) and leaves the invite Simon sent into `acme` open.

## Exit checklist

- [x] Owner, setting, invite rules, revoke on off
- [x] Migration, route, `bun run generate`, `flockr orgs set`, web controls
- [x] Tests above; `bun run check`
- [x] Phase 11 README, connection guide, master checklist row

## Notes from the build

- Accepting an invite made the member as the inviter, through the host-only rule for adding members, so a client owner's invitee would have failed at first sign-in. `createMember` takes `{ invited: true }` from `acceptInvite`: the check happened when the invite was made.
- `orgs.owner` is a plain name, not a foreign key: with one, `members.org` and `orgs.owner` formed a cycle and the backup restore (PL4) refused to order the tables. `updateOrg` checks the owner is a person in the org instead. A line in the backend checklist now says so.
- `/api/invites` was a board-wide route in the request guard (host only); it is a viewer route now, and the board rule decides.
