---
name: net-werk
description: Set up and run a "harness" — specs + a task graph + an agent loop that builds the project one verified task at a time — and watch it in the net-werk dashboard. Use when the user wants to "do a harness", "harness this", "set this up as a graph", run a Ralph loop, "run the harness", "start the loop", "watch it build", or asks why a loop stopped. With no harness yet it plans one in plan mode first; only after the user approves the plan does it scaffold, open the dashboard and start the loop.
---

# net-werk: plan the harness, then open it and let it run

A harness builds a project in a loop: `specs/` say what's true, `harness/graph/*.md` is the work
as a DAG of small verifiable tasks, and `harness/bin/loop.sh` runs one fresh `claude -p` per
task, which does that task, proves it with the gates, and commits. net-werk is the dashboard
for it: the graph live, whether a loop is really running, and why it stopped.
https://github.com/Julius-PC/net-werk

**The order never changes: plan → approval → scaffold → open → start.** Nothing opens and
nothing runs before the user has approved a plan, because a loop is only as good as the plan it
runs.

## 0. Find the CLI

Use `net-werk` if `command -v net-werk` finds it; otherwise use
`npx -y github:Julius-PC/net-werk` in its place everywhere below (the first run downloads it —
say so). If neither works, stop and point the user at the install steps in the README.

## 1. Is there a harness already?

Project root: the repo the user named, else `git rev-parse --show-toplevel`, else the current
directory. Then:

```bash
net-werk info <root>
```

- Exits 1 with "not scaffolded" → **step 2** (plan it).
- Prints the project's state → it's scaffolded. Skip to **step 4** (open), then **step 5** if
  the user asked to run it.

## 2. Plan it — in plan mode

Enter plan mode now (the `EnterPlanMode` tool; if you can't, ask the user to switch to plan mode
and wait). Plan mode is read-only: explore, ask, and write the plan — no files yet.

1. Understand the project: read the repo, and ask the user what it's for, what "done" looks like,
   and what must never happen (secrets, money, privacy, production data). Ask rather than guess.
2. Write the plan, covering:
   - **Specs** — the files under `specs/`, one per concern, and what each will say. Decisions
     the user states become lines attributed to them, like `(Ana, 2026-09-30)`; the loop may
     never edit those.
   - **The task graph** — every task: `id`, one-line title, `owner` (`agent`, or `human` for
     credentials, sign-ups, money, taste, DNS), `depends_on`, observable `acceptance`, a
     `verify` command, the `spec` it implements. Each small enough for one iteration. Show the
     dependency order.
   - **Project rules** — what goes in the "Project rules" section of the build and plan prompts.
   - **Gates** — the checks `harness/bin/verify.mjs` will run (tests, build, lint, scans).
   - **The run** — mode and number of iterations (default `build` × 10), and that approving the
     plan means: scaffold, commit, open net-werk, and start the loop.
3. Present it with `ExitPlanMode`. If the user asks for changes, revise and present again.

## 3. Scaffold it — only after approval

```bash
git -C <root> rev-parse --git-dir || git -C <root> init    # the loop measures progress in commits
net-werk init <root>
```

`init` copies the machinery into `harness/` (graph engine, loop, log formatter, gates, schema,
prompts) and adds `harness/.loop.log` to `.gitignore`. It never overwrites existing files. Then
write what the plan said:

1. `specs/*.md`.
2. One `harness/graph/<id>.md` per task — YAML frontmatter valid against
   `harness/schema/task.schema.json`, `status: todo`, then the brief as markdown.
3. The "Project rules" section in `harness/prompts/build.md` and `harness/prompts/plan.md`.
4. The project's gates in the `GATES` list of `harness/bin/verify.mjs`.

Check and commit — the commit message must start with `plan:`, which the loop reads as "the
graph is current":

```bash
node harness/bin/graph.mjs validate
node harness/bin/verify.mjs          # gates for code that doesn't exist yet should skip, not fail
git add -A && git commit -m "plan: scaffold the harness"
```

## 4. Open the dashboard

```bash
net-werk open <root> --no-browser
```

It starts the server if needed (127.0.0.1 only) and prints the project's URL. Show it: in the
Claude desktop app open the URL in the browser pane; otherwise run the command again without
`--no-browser`. Give a two- or three-line read from `net-werk info`: done/total, what's in
`doing` (and whether it's stalled), whether a loop is running or why it stopped, and what's
waiting on the user.

## 5. Start the loop

Start it straight after scaffolding (the approved plan said so), or when the user asked to run
an existing harness ("run the harness", "start the loop", `/net-werk`). If they only asked to
look, offer instead. Before starting, check `net-werk info`:

- a loop is already running → don't start a second; say so;
- `graph problems` → stop; they have to be fixed first;
- nothing `ready for the agent` → nothing to do; say what's waiting on the user;
- a stalled task → starting resumes it; mention that.

```bash
net-werk start <root> --mode build --iterations 10
```

It returns straight away; the loop runs detached and the dashboard shows each iteration live.
Don't sit and poll it. When it stops at **Waiting on you**, the user does their tasks and marks
them done with ✓ Mark done on the dashboard (or `net-werk done <root> <task-id>`); a blocked task
is unblocked once what it needs is in the specs (`net-werk unblock <root> <task-id> --note "…"`).
Then start it again. It stops by itself when every task is done, when only human tasks are
left, or after two iterations without a commit. `net-werk stop <root>` ends it early — only when
asked; the task in `doing` stays there and the next run resumes it.
