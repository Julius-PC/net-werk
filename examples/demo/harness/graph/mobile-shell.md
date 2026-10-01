---
id: mobile-shell
title: Wrap the web app as an installable mobile app
phase: mobile
status: done
owner: agent
priority: 1
depends_on:
  - web-shell
  - sync-engine
spec: specs/mobile.md
verify: npm test
acceptance:
  - Wrap the web app as an installable mobile app, with a test that fails if it breaks
---

Wrap the web app as an installable mobile app. Read specs/mobile.md first; keep the change to this task.
