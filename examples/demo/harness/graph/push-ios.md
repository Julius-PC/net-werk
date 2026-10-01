---
id: push-ios
title: Deliver push notifications on iOS
phase: sync
status: done
owner: agent
priority: 2
depends_on:
  - push-notify
  - push-cert
spec: specs/sync.md
verify: npm test
acceptance:
  - Deliver push notifications on iOS, with a test that fails if it breaks
---

Deliver push notifications on iOS. Read specs/sync.md first; keep the change to this task.
