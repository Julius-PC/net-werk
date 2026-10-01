---
id: recipe-scaling
title: Scale a recipe to any number of servings
phase: data
status: done
owner: agent
priority: 3
depends_on:
  - recipes-model
  - units-convert
spec: specs/data.md
verify: npm test
acceptance:
  - Scale a recipe to any number of servings, with a test that fails if it breaks
---

Scale a recipe to any number of servings. Read specs/data.md first; keep the change to this task.
