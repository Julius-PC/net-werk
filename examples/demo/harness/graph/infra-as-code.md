---
id: infra-as-code
title: Describe the infrastructure as code
phase: deploy
status: done
owner: agent
priority: 2
depends_on:
  - api-skeleton
spec: specs/deploy.md
verify: npm test
acceptance:
  - Describe the infrastructure as code, with a test that fails if it breaks
---

Describe the infrastructure as code. Read specs/deploy.md first; keep the change to this task.
