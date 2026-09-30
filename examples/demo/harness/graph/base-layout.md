---
id: base-layout
title: Build the base layout, nav and footer
phase: scaffold
status: done
owner: agent
priority: 2
depends_on:
  - scaffold-site
spec: specs/site.md
verify: npm run build
acceptance:
  - Every page shares one layout with a skip link and visible focus states
---

Keep it plain: header, main, footer.
