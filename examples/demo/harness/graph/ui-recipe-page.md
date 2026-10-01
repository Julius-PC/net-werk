---
id: ui-recipe-page
title: Build the recipe page with scaling
phase: ui
status: done
owner: agent
priority: 1
depends_on:
  - ui-recipes
  - recipe-scaling
spec: specs/ui.md
verify: npm test
acceptance:
  - Build the recipe page with scaling, with a test that fails if it breaks
---

Build the recipe page with scaling. Read specs/ui.md first; keep the change to this task.
