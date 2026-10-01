---
id: auth-passkeys
title: Add passkey sign-in
phase: scaffold
status: done
owner: agent
priority: 1
depends_on:
  - api-skeleton
  - db-schema
spec: specs/product.md
verify: npm test
acceptance:
  - Add passkey sign-in, with a test that fails if it breaks
---

Add passkey sign-in. Read specs/product.md first; keep the change to this task.
