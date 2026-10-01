---
id: observability
title: Add error tracking and uptime checks
phase: deploy
status: done
owner: agent
priority: 3
depends_on:
  - deploy-staging
spec: specs/deploy.md
verify: npm test
acceptance:
  - Add error tracking and uptime checks, with a test that fails if it breaks
---

Add error tracking and uptime checks. Read specs/deploy.md first; keep the change to this task.
