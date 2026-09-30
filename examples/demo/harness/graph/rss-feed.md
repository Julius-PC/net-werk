---
id: rss-feed
title: Publish an RSS feed of new recipes
phase: content
status: todo
owner: agent
priority: 3
depends_on:
  - recipe-pages
spec: specs/site.md
verify: npm run build
acceptance:
  - /rss.xml validates and lists the newest 20 recipes
---

Plain RSS 2.0.
