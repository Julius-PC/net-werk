---
id: security-review
title: Review auth, sync and sharing for security bugs
phase: deploy
status: todo
owner: agent
priority: 3
depends_on:
  - list-sharing
  - sync-conflicts
  - auth-passkeys
spec: specs/deploy.md
verify: npm test
acceptance:
  - Review auth, sync and sharing for security bugs, with a test that fails if it breaks
---

Review auth, sync and sharing for security bugs. Read specs/deploy.md first; keep the change to this task.
