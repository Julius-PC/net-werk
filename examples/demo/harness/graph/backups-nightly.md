---
id: backups-nightly
title: Back up the database every night
phase: deploy
status: done
owner: agent
priority: 2
depends_on:
  - deploy-staging
spec: specs/deploy.md
verify: npm test
acceptance:
  - Back up the database every night, with a test that fails if it breaks
---

Back up the database every night. Read specs/deploy.md first; keep the change to this task.
