---
id: recipe-ocr
title: Scan recipes from photos of cookbooks
phase: data
status: dropped
owner: agent
priority: 2
depends_on:
  - recipes-model
spec: specs/data.md
verify: npm test
acceptance:
  - Scan recipes from photos of cookbooks, with a test that fails if it breaks
notes: "Dropped: OCR quality was too low to trust. Replaced by recipe-import."
---

Scan recipes from photos of cookbooks. Read specs/data.md first; keep the change to this task.
