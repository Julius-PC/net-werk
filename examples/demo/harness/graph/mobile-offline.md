---
id: mobile-offline
title: Cache the app for offline use
phase: mobile
status: done
owner: agent
priority: 3
depends_on:
  - mobile-shell
  - sync-conflicts
spec: specs/mobile.md
verify: npm test
acceptance:
  - Cache the app for offline use, with a test that fails if it breaks
---

Cache the app for offline use. Read specs/mobile.md first; keep the change to this task.
