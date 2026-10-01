---
id: api-recipes
title: Serve recipes over the API
phase: api
status: done
owner: agent
priority: 2
depends_on:
  - recipes-model
  - api-skeleton
spec: specs/api.md
verify: npm test
acceptance:
  - Serve recipes over the API, with a test that fails if it breaks
---

Serve recipes over the API. Read specs/api.md first; keep the change to this task.
