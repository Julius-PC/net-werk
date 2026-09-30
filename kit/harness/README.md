# harness/

This project builds itself: `specs/` say what's true, `graph/` is the work as a graph of small
verifiable tasks, `bin/loop.sh` runs one fresh `claude -p` per task, and `bin/verify.mjs` decides
whether a task is really done. Scaffolded from the [net-werk](https://github.com/Julius-PC/net-werk)
kit; `net-werk open .` shows it live.

```bash
./harness/bin/loop.sh build 10        # up to 10 iterations; stops early by itself
node harness/bin/graph.mjs status     # where the build is
node harness/bin/graph.mjs next       # the one task to do now
node harness/bin/graph.mjs validate   # schema + DAG check
node harness/bin/verify.mjs           # the gates
```

| Part | Job |
| --- | --- |
| `graph/<id>.md` | one task: frontmatter (`status`, `owner`, `depends_on`, `acceptance`, `verify`, `spec`, `notes`) + a brief |
| `schema/task.schema.json` | what a task file may contain |
| `prompts/build.md`, `plan.md` | what one iteration does, and how the graph is re-derived from the specs |
| `bin/loop.sh` | the loop; re-plans first whenever `specs/` changed since the last `plan:` commit |
| `bin/verify.mjs` | the gates — add this project's tests and checks |
| `.loop.log` | the loop's output (gitignored), tailed by net-werk |

`owner: human` tasks are gates the loop can't pass (credentials, money, taste); it stops at
them. `doing` is a lock on the task being worked on; `dropped` means superseded — terminal,
but not done.
