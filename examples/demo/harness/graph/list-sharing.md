---
id: list-sharing
title: Share a shopping list with the household
phase: api
status: done
owner: agent
priority: 2
depends_on:
  - shopping-list
  - auth-passkeys
spec: specs/api.md
verify: npm test
acceptance:
  - Share a shopping list with the household, with a test that fails if it breaks
---

Share a shopping list with the household. Read specs/api.md first; keep the change to this task.
