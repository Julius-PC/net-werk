---
id: recipe-pages
title: Render a page per recipe
phase: content
status: done
owner: agent
priority: 1
depends_on:
  - content-model
  - base-layout
spec: specs/site.md
verify: npm run build
acceptance:
  - Each recipe renders at /recipes/<slug> with ingredients and steps
---

Scale the ingredient list by the serves field.
