---
id: webhooks
title: Send webhooks when the list changes
phase: api
status: done
owner: agent
priority: 3
depends_on:
  - list-sharing
spec: specs/api.md
verify: npm test
acceptance:
  - Send webhooks when the list changes, with a test that fails if it breaks
---

Send webhooks when the list changes. Read specs/api.md first; keep the change to this task.
