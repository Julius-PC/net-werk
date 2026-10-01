---
id: ios-beta
title: Ship an iOS beta build
phase: mobile
status: todo
owner: agent
priority: 2
depends_on:
  - mobile-offline
  - app-store-account
spec: specs/mobile.md
verify: npm test
acceptance:
  - Ship an iOS beta build, with a test that fails if it breaks
---

Ship an iOS beta build. Read specs/mobile.md first; keep the change to this task.
