---
id: push-notify
title: Send expiry reminders as push notifications
phase: sync
status: done
owner: agent
priority: 3
depends_on:
  - expiry-tracking
  - sync-engine
spec: specs/sync.md
verify: npm test
acceptance:
  - Send expiry reminders as push notifications, with a test that fails if it breaks
---

Send expiry reminders as push notifications. Read specs/sync.md first; keep the change to this task.
