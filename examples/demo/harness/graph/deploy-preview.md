---
id: deploy-preview
title: Connect the host to the repository
phase: deploy
status: todo
owner: human
priority: 2
depends_on:
  - scaffold-site
spec: specs/site.md
verify: npm run build
acceptance:
  - Pushing to main publishes a preview URL
---

Needs an account on the host — a human gate.
