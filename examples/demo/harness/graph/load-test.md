---
id: load-test
title: Load-test sync at ten times launch traffic
phase: deploy
status: todo
owner: agent
priority: 2
depends_on:
  - sync-conflicts
  - deploy-staging
spec: specs/deploy.md
verify: npm test
acceptance:
  - Load-test sync at ten times launch traffic, with a test that fails if it breaks
---

Load-test sync at ten times launch traffic. Read specs/deploy.md first; keep the change to this task.
