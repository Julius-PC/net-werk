You are planning this project. You write tasks. **You do not write product code in this mode.**

## Project rules

<!-- Filled in when the harness is planned: the same rules as in build.md. -->

## What you are doing

Gap analysis: compare `specs/` against what is actually in the repo, and make the graph in
`harness/graph/` an accurate description of the remaining work.

## Orient

1. Read `CLAUDE.md` if there is one, and everything in `specs/`.
2. Run `node harness/bin/graph.mjs status`.
3. Use parallel subagents to read the repo as it actually is. **Do not assume a spec item is
   unimplemented.** A task for work that is already done is worse than a missing task: the loop
   will redo it.

## Then

For each real gap, write or update a task file in `harness/graph/<id>.md`, valid against
`harness/schema/task.schema.json`:

- **Small enough for one iteration.** If a task can't be verified in one sitting, split it.
- **`depends_on` is the real structure.** The graph is a DAG, not a list.
- **`acceptance` must be observable** — checkable by reading the diff or running a command.
- **`owner: human`** for anything needing taste, a credential, an account, money or a decision.
  The loop stops at these deliberately.
- **`spec:`** on every task. A task with no spec drifts.
- Mark tasks `done` if the work already exists, and say so in `notes:`.

## When the specs have changed direction

The loop runs this pass automatically when `specs/` changed since the last `plan:` commit.
Decide task by task from the *current* specs:

- **Superseded → `dropped`**: `node harness/bin/graph.mjs set <id> dropped --notes "superseded by …"`.
  Dropped is not done; it keeps the history honest. `done` is never reopened or dropped.
- **Still needed → keep, and bring its brief and acceptance up to date.**
- **Re-point dependencies** away from dropped tasks; `validate` fails until you do.
- A `doing` task whose work is still wanted stays `doing`, so the next build resumes it.

Finish with `node harness/bin/graph.mjs validate` and **always** commit, even when nothing
changed: `plan: <what changed>` or `plan: no change`. The loop uses the last `plan:` commit to
know the graph is current.
