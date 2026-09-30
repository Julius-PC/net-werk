---
id: content-model
title: Define the recipe content model
phase: scaffold
status: done
owner: agent
priority: 1
depends_on:
  - scaffold-site
spec: specs/site.md
verify: npm run build
acceptance:
  - Every recipe has title, time, serves, ingredients and steps, validated at build
---

One markdown file per recipe with typed frontmatter.
