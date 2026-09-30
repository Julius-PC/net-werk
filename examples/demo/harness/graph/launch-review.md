---
id: launch-review
title: Review every page at phone and desktop widths
phase: deploy
status: todo
owner: agent
priority: 2
depends_on:
  - search-index
  - print-styles
  - rss-feed
  - photo-pipeline
  - domain-dns
spec: specs/site.md
verify: npm run build
acceptance:
  - Every route checked at 375px and 1440px; findings fixed or filed as tasks
---

The last gate before launch.
