---
name: net-work
description: Open the net-work dashboard on a harness project (specs + harness/graph task graph + harness/bin/loop.sh) and start its agent loop. Use when the user says "net-work", "run the harness", "start the loop", "kick off the build", "watch it build", "open the dashboard", or asks why a loop stopped or how far a build has got. Only for projects whose harness is already scaffolded — if it isn't, plan the harness first and do not start anything.
---

# net-work: open the dashboard, then run the harness

net-work is a local dashboard for repos that build themselves with an agent loop: `specs/` say
what's true, `harness/graph/*.md` is a DAG of small verifiable tasks, and `harness/bin/loop.sh`
runs one fresh `claude -p` per task. It shows the graph live, whether a loop is really running,
and why it last stopped; it can start and stop the loop. https://github.com/Julius-PC/net-work

## 0. Find the CLI

Use `net-work` if `command -v net-work` finds it. Otherwise use
`npx -y github:Julius-PC/net-work` in its place everywhere below (the first run downloads it;
say so). If neither works, stop and point the user at the install steps in the README.

## 1. Gate: is the harness scaffolded?

Work out the project root (the repo the user named, else `git rev-parse --show-toplevel`), then:

```bash
net-work info <root>
```

**Not scaffolded** (it exits 1 with "no harness/graph/"), or the graph has no tasks, or there is
no `harness/bin/loop.sh`: **stop here.** Don't open the dashboard, don't write a loop script,
don't start anything. A loop is only as good as the plan it runs, so the plan comes first. Tell
the user that, and offer to plan the harness with them — in plan mode, before writing files:

1. `specs/` — what is true and what is being built, one file per concern.
2. `harness/graph/<id>.md` — one task per file with YAML frontmatter: `id`, `title`, `status`
   (`todo`), `owner` (`agent`, or `human` for credentials, sign-ups, money, taste),
   `depends_on`, observable `acceptance`, a `verify` command, the `spec` it implements. Each task
   small enough for one iteration.
3. `harness/prompts/build.md` — what one iteration does: take the next task, do only it,
   verify, mark it done, commit.
4. `harness/bin/loop.sh <mode> <n>` — runs the prompt through `claude -p` up to n times, tees
   its output to `harness/.loop.log`, and stops by itself when only human tasks remain or after
   two iterations without a commit. (The README documents the log lines net-work understands.)
5. Gates — the checks `verify` runs; add `harness/.loop.log` to `.gitignore`.

Only once the user has approved the plan and it's scaffolded and committed, come back to step 2.

## 2. Open the dashboard

```bash
net-work open <root> --no-browser
```

It starts the server if needed (127.0.0.1 only) and prints the project's URL. Show it: in the
Claude desktop app open the URL in the browser pane; otherwise run the command again without
`--no-browser`.

Then give a two- or three-line read from `net-work info`: done/total, what's in `doing` (and
whether it's stalled), whether a loop is running or why it stopped, and anything waiting on the
user.

## 3. Start the loop

Start it when the user invoked this skill to run the harness ("run the harness", "start the
loop", "/net-work") — not when they only asked to look at progress; then offer instead. A loop
spends tokens and lets an agent edit and commit in the repo.

Before starting, check `net-work info`:
- a loop is already running → don't start a second; say so and show the dashboard;
- `graph problems` → stop; they have to be fixed first;
- `ready for the agent: —` → nothing for the loop to do; say what's waiting on the user;
- a stalled task → starting resumes it; mention that.

Mode and count: use what the user said; otherwise `build` and 10, and say so.

```bash
net-work start <root> --mode build --iterations 10
```

It returns straight away; the loop runs detached and the dashboard shows each iteration live.
Don't sit and poll it. To stop it — only when asked — `net-work stop <root>`, which ends the loop
and its agent; the task in `doing` stays there and the next run resumes it.
