---
id: domain-dns
title: Point the domain at the host
phase: deploy
status: todo
owner: human
priority: 3
depends_on:
  - deploy-preview
spec: specs/site.md
verify: npm run build
acceptance:
  - The domain serves the site over HTTPS
---

DNS access is a human gate.
