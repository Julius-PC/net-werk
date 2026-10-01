---
id: deploy-staging
title: Deploy staging on every push to main
phase: deploy
status: done
owner: agent
priority: 1
depends_on:
  - infra-as-code
  - cloud-account
spec: specs/deploy.md
verify: npm test
acceptance:
  - Deploy staging on every push to main, with a test that fails if it breaks
---

Deploy staging on every push to main. Read specs/deploy.md first; keep the change to this task.
