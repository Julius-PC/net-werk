---
id: ui-onboarding
title: Build first-run onboarding
phase: ui
status: done
owner: agent
priority: 2
depends_on:
  - ui-pantry
  - auth-passkeys
spec: specs/ui.md
verify: npm test
acceptance:
  - Build first-run onboarding, with a test that fails if it breaks
---

Build first-run onboarding. Read specs/ui.md first; keep the change to this task.
