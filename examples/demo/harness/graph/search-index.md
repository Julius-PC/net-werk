---
id: search-index
title: Add client-side search over recipes
phase: content
status: doing
owner: agent
priority: 2
depends_on:
  - recipe-pages
spec: specs/site.md
verify: npm run build
acceptance:
  - Searching an ingredient finds every recipe that uses it
notes: The index builds but misses ingredient lists; they need data-search-body on the ingredients block.
---

Build a static search index at build time.
