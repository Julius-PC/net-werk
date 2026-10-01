---
id: launch-review
title: Review every screen at phone and desktop widths
phase: launch
status: todo
owner: agent
priority: 1
depends_on:
  - a11y-pass
  - store-screenshots
  - privacy-page
spec: specs/launch.md
verify: npm test
acceptance:
  - Review every screen at phone and desktop widths, with a test that fails if it breaks
---

Review every screen at phone and desktop widths. Read specs/launch.md first; keep the change to this task.
