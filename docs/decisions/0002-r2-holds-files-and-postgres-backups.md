# 0002: Cloudflare R2 holds files and Postgres backups

Status: accepted again through [0006](0006-postgres-is-the-data-store.md) after 0004 briefly superseded it. Accepted 24 Nov 2026. Adds to [0001](0001-flockr-runs-on-a-vps-not-cloudflare.md); supersedes nothing. Its backup method (base backup plus WAL archive) is superseded in part by [0023](0023-backups-are-nightly-logical-copies-in-the-bucket.md).

## Problem

Postgres on one VPS has no copy off the box, and attached files need a home outside the database.

## Options

| Option | Good | Cost |
|---|---|---|
| R2 (S3-compatible) | No egress fees, cheap, one bucket for files and backups | One Cloudflare dependency for storage only |
| Another S3 bucket (Backblaze, Hetzner) | Same | Another account |
| Local disk only | Nothing to set up | A lost VPS loses everything |

## Choice

R2 for attached files and for Postgres backups (nightly base backup plus continuous WAL archive). Postgres itself still runs on the VPS disk; R2 cannot hold live database files.

## Why

Plain S3 calls mean the bucket can be swapped later without code changes, so the agnostic goal of 0001 holds.

## Costs

- Restoring means replaying from R2 onto a new box; practise it once before relying on it.
- Backup keys live in Infisical.
