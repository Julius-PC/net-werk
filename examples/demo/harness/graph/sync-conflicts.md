---
id: sync-conflicts
title: Resolve sync conflicts without losing edits
phase: sync
status: done
owner: agent
priority: 2
depends_on:
  - sync-engine
spec: specs/sync.md
verify: npm test
acceptance:
  - Resolve sync conflicts without losing edits, with a test that fails if it breaks
---

Resolve sync conflicts without losing edits. Read specs/sync.md first; keep the change to this task.
