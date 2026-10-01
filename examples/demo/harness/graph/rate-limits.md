---
id: rate-limits
title: Rate-limit the public API
phase: deploy
status: todo
owner: agent
priority: 1
depends_on:
  - deploy-staging
  - api-items
spec: specs/deploy.md
verify: npm test
acceptance:
  - Rate-limit the public API, with a test that fails if it breaks
---

Rate-limit the public API. Read specs/deploy.md first; keep the change to this task.
