---
id: print-styles
title: Make recipes print cleanly on one page
phase: design
status: todo
owner: agent
priority: 3
depends_on:
  - recipe-pages
  - design-tokens
spec: specs/site.md
verify: npm run build
acceptance:
  - Printing a recipe gives one page with no nav or footer
---

A print stylesheet, nothing else.
