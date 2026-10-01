---
id: barcode-lookup
title: Look up products by barcode
phase: data
status: done
owner: agent
priority: 2
depends_on:
  - items-model
spec: specs/data.md
verify: npm test
acceptance:
  - Look up products by barcode, with a test that fails if it breaks
---

Look up products by barcode. Read specs/data.md first; keep the change to this task.
