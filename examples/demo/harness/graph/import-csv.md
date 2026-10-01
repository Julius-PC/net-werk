---
id: import-csv
title: Import a pantry from a CSV export
phase: data
status: done
owner: agent
priority: 3
depends_on:
  - items-model
spec: specs/data.md
verify: npm test
acceptance:
  - Import a pantry from a CSV export, with a test that fails if it breaks
---

Import a pantry from a CSV export. Read specs/data.md first; keep the change to this task.
