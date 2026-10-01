---
id: ui-scan
title: Build the barcode scanner screen
phase: ui
status: done
owner: agent
priority: 2
depends_on:
  - barcode-lookup
  - ui-pantry
spec: specs/ui.md
verify: npm test
acceptance:
  - Build the barcode scanner screen, with a test that fails if it breaks
---

Build the barcode scanner screen. Read specs/ui.md first; keep the change to this task.
