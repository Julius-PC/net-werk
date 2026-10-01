---
id: plans-model
title: Model weekly meal plans
phase: data
status: done
owner: agent
priority: 2
depends_on:
  - recipes-model
spec: specs/data.md
verify: npm test
acceptance:
  - Model weekly meal plans, with a test that fails if it breaks
---

Model weekly meal plans. Read specs/data.md first; keep the change to this task.
