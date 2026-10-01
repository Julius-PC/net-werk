---
id: a11y-pass
title: Fix every accessibility issue the audit reports
phase: ui
status: done
owner: agent
priority: 1
depends_on:
  - ui-planner
  - ui-shopping
  - ui-recipe-page
spec: specs/ui.md
verify: npm test
acceptance:
  - Fix every accessibility issue the audit reports, with a test that fails if it breaks
---

Fix every accessibility issue the audit reports. Read specs/ui.md first; keep the change to this task.
