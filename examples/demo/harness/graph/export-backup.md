---
id: export-backup
title: Export everything as a backup file
phase: sync
status: done
owner: agent
priority: 3
depends_on:
  - sync-engine
spec: specs/sync.md
verify: npm test
acceptance:
  - Export everything as a backup file, with a test that fails if it breaks
---

Export everything as a backup file. Read specs/sync.md first; keep the change to this task.
