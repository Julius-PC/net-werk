---
id: scaffold-site
title: Scaffold the static site
phase: scaffold
status: done
owner: agent
priority: 1
spec: specs/site.md
verify: npm run build
acceptance:
  - npm run build produces dist/ with an index page
---

Start from the static-site template; no client framework.
