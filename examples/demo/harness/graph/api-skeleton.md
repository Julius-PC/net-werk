---
id: api-skeleton
title: Stand up the API server with health checks
phase: scaffold
status: done
owner: agent
priority: 3
depends_on:
  - repo-bootstrap
spec: specs/product.md
verify: npm test
acceptance:
  - Stand up the API server with health checks, with a test that fails if it breaks
---

Stand up the API server with health checks. Read specs/product.md first; keep the change to this task.
