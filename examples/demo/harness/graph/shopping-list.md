---
id: shopping-list
title: Generate a shopping list from the week's plan
phase: api
status: done
owner: agent
priority: 1
depends_on:
  - plans-model
  - pantry-match
spec: specs/api.md
verify: npm test
acceptance:
  - Generate a shopping list from the week's plan, with a test that fails if it breaks
---

Generate a shopping list from the week's plan. Read specs/api.md first; keep the change to this task.
