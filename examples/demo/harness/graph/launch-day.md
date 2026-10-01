---
id: launch-day
title: Flip the launch switch
phase: launch
status: todo
owner: human
priority: 2
depends_on:
  - deploy-prod
  - launch-review
  - beta-invites
  - domain-dns
spec: specs/launch.md
acceptance:
  - Flip the launch switch — and say so in the task's notes
---

A gate the loop can't pass: flip the launch switch. Mark it done in net-werk when it's finished.
