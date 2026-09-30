---
id: design-tokens
title: Put the chosen palette and type into tokens
phase: design
status: done
owner: agent
priority: 2
depends_on:
  - choose-palette
  - base-layout
spec: specs/site.md
verify: npm run build
acceptance:
  - Colors, spacing and type come from one tokens file
---

No raw hex values outside the tokens file.
