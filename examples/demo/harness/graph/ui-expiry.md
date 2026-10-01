---
id: ui-expiry
title: Show what's about to expire on the home screen
phase: ui
status: done
owner: agent
priority: 1
depends_on:
  - expiry-tracking
  - ui-pantry
spec: specs/ui.md
verify: npm test
acceptance:
  - Show what's about to expire on the home screen, with a test that fails if it breaks
---

Show what's about to expire on the home screen. Read specs/ui.md first; keep the change to this task.
