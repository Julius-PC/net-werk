---
id: deploy-prod
title: Deploy production behind a manual approval
phase: deploy
status: todo
owner: agent
priority: 1
depends_on:
  - deploy-staging
  - backups-nightly
  - observability
spec: specs/deploy.md
verify: npm test
acceptance:
  - Deploy production behind a manual approval, with a test that fails if it breaks
---

Deploy production behind a manual approval. Read specs/deploy.md first; keep the change to this task.
