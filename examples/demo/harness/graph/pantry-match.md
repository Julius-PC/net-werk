---
id: pantry-match
title: Match recipes against what's in the pantry
phase: data
status: done
owner: agent
priority: 1
depends_on:
  - recipe-scaling
  - items-model
spec: specs/data.md
verify: npm test
acceptance:
  - Match recipes against what's in the pantry, with a test that fails if it breaks
---

Match recipes against what's in the pantry. Read specs/data.md first; keep the change to this task.
