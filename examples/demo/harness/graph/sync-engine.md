---
id: sync-engine
title: Sync changes between devices, offline-first
phase: sync
status: done
owner: agent
priority: 1
depends_on:
  - api-items
  - api-plans
spec: specs/sync.md
verify: npm test
acceptance:
  - Sync changes between devices, offline-first, with a test that fails if it breaks
---

Sync changes between devices, offline-first. Read specs/sync.md first; keep the change to this task.
