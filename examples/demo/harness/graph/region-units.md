---
id: region-units
title: Pick default units from the household's region
phase: data
status: blocked
owner: agent
priority: 1
depends_on:
  - units-convert
spec: specs/units.md
verify: npm test
acceptance:
  - Pick default units from the household's region, with a test that fails if it breaks
notes: "Blocked: needs a decision — which regions default to imperial? specs/units.md only lists the US. Is the UK metric for weight but imperial for milk? Add the answer to specs/units.md."
---

Pick default units from the household's region. Read specs/units.md first; keep the change to this task.
