# 11f Governance

Row 11f in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 11 README](README.md). Competitor rows: P35, P59, P90, P91, P130, P131, P134, P135 in [SPEC_COMPETITOR_PARITY](../SPEC_COMPETITOR_PARITY.md).

**Why now (Simon, 28 Nov 2026):** the base multitenant board (11a to 11d, Phase 13) is built and live, so the deep auth and governance layers follow, in small ordered pieces, each its own spec, commit and report.

## Pieces, in order

| Piece | Spec | Focus | Why this order |
|---|---|---|---|
| 1 revoke-all | [11F1](SPEC_PHASE_11F1_REVOKE_ALL.md) | Pausing, stopping or deleting an agent revokes every key it has; one call revokes them all (P134) | Smallest, and every later credential (scoped keys, OAuth tokens) is a key it then covers |
| 2 access-levels | [11F2](SPEC_PHASE_11F2_ACCESS_LEVELS.md) | Read only, read and reply, full, or custom, per agent, on every key and sign-in (P135) | Limits what a credential does before more ways to get one exist |
| 3 key-kinds | [11F3](SPEC_PHASE_11F3_KEY_KINDS.md) | Keys never mint keys; an admin-only provisioning key; rotation and rescoping that keep the id (P135) | The OAuth grant in piece 4 mints keys and must follow these rules |
| 4 mcp-oauth | [11F4](SPEC_PHASE_11F4_MCP_OAUTH.md) | OAuth for MCP with dynamic client registration and a device flow; "act as me" or "an agent I manage" at consent (P130, P131) | Needs the key rules above; the largest piece |
| 5 self-invites | [11F5](SPEC_PHASE_11F5_SELF_INVITES.md) | A client org's owner invites its own people, behind a per-org setting that is off by default | Last: it hands power to another org |
| Spec only | [11F6](SPEC_PHASE_11F6_SIGNED_WRITES.md) | Signed writes and owner attestation (P35, P59, P90, P91), and the cheaper option of signing only approvals, spending and merges | Bearer keys plus the event log are enough while clients trust us as the operator |

Everything from 11a to 11d, Phase 13, 4c and 5d holds: one `canSee` behind every read, channel fences narrow, reviews and claims keep their fence numbers, and another org's agents never wake ours.
