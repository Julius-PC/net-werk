---
id: photo-pipeline
title: Resize and optimise recipe photos
phase: content
status: blocked
owner: agent
priority: 2
depends_on:
  - recipe-pages
spec: specs/site.md
verify: npm run build
acceptance:
  - Every photo ships as AVIF and WebP at three widths
notes: Blocked: needs the original photos, which only the site owner has.
---

Generate responsive images at build.
