---
id: nutrition-import
title: Import nutrition facts for scanned products
phase: data
status: done
owner: agent
priority: 1
depends_on:
  - barcode-lookup
  - food-db-key
spec: specs/data.md
verify: npm test
acceptance:
  - Import nutrition facts for scanned products, with a test that fails if it breaks
---

Import nutrition facts for scanned products. Read specs/data.md first; keep the change to this task.
