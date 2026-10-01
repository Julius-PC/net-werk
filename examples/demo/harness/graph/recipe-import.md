---
id: recipe-import
title: Import a recipe from any URL
phase: data
status: done
owner: agent
priority: 1
depends_on:
  - recipes-model
spec: specs/data.md
verify: npm test
acceptance:
  - Import a recipe from any URL, with a test that fails if it breaks
---

Import a recipe from any URL. Read specs/data.md first; keep the change to this task.
