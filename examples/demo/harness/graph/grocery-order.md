---
id: grocery-order
title: Send the shopping list to a grocery delivery partner
phase: api
status: todo
owner: agent
priority: 3
depends_on:
  - shopping-list
  - grocery-terms
spec: specs/api.md
verify: npm test
acceptance:
  - Send the shopping list to a grocery delivery partner, with a test that fails if it breaks
---

Send the shopping list to a grocery delivery partner. Read specs/api.md first; keep the change to this task.
