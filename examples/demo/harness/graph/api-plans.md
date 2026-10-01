---
id: api-plans
title: Serve meal plans over the API
phase: api
status: done
owner: agent
priority: 3
depends_on:
  - plans-model
  - api-skeleton
spec: specs/api.md
verify: npm test
acceptance:
  - Serve meal plans over the API, with a test that fails if it breaks
---

Serve meal plans over the API. Read specs/api.md first; keep the change to this task.
