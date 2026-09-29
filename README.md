# harness-viz

A live view of any repo built by **the harness**: `specs/` + `harness/graph/` task DAG +
`loop.sh`. Open it next to a running loop and watch tasks go ready → doing → done.

```bash
node ~/code/harness-viz/bin/harness-viz.mjs          # http://127.0.0.1:4545
```

- **Finds projects on its own.** Any `~/code/*/` with a `harness/graph/` shows up as a tab.
  Register one elsewhere with `harness-viz add <path>`. `list` and `remove` do what they say.
- **Updates live.** The server fingerprints each project every 1.5s (task-file mtimes, git
  HEAD, loop log) and pushes a fresh snapshot over server-sent events when anything changes.
- **Read-only.** It never writes to a project. It binds 127.0.0.1 only, because task briefs
  are private plans.
- **Zero dependencies.** Node's `http` and one static page. Nothing to install and nothing to
  rot.

## Run it at login

```bash
node ~/code/harness-viz/bin/harness-viz.mjs install     # LaunchAgent com.julius.harness-viz
node ~/code/harness-viz/bin/harness-viz.mjs status
node ~/code/harness-viz/bin/harness-viz.mjs uninstall
```

`install` writes `~/Library/LaunchAgents/com.julius.harness-viz.plist` (RunAtLoad, KeepAlive,
30s throttle) and bootstraps it. Logs go to `~/Library/Logs/harness-viz.log`. If another copy
already holds the port, launchd retries until it is free.

## What you see

| Area | Shows |
| --- | --- |
| Progress | done / doing / ready / blocked / waiting counts |
| Building now | the task in `doing`, and how long it has been there. When idle, the next ready agent task |
| Waiting on you | ready `owner: human` tasks, plus anything `blocked` |
| Iteration flow | Orient → Implement → Verify → Commit for the running iteration, inferred live from the agent's tool calls, with a lane of those calls sliding in |
| Graph | the DAG, left to right by dependency depth. Green is done, amber and pulsing is doing, blue is ready, a dashed purple border marks your tasks, red is blocked. Click a task to highlight its chain and open its brief, acceptance, verify, spec and notes |
| Commits | recent commits. `task(<id>)` commits link to their task |
| Loop log | the tail of `harness/.loop.log`, if the project's loop writes one |

**Motion.** Current flows along the edges into the task being built, and each tool call floats up
off that node. A finished task bursts green and its newly unlocked tasks glow. With **Follow**
on, the camera glides to whatever is being built. All of it is off under
`prefers-reduced-motion`.

## Live loop log

A project's loop can pipe the agent's activity into the log like this (yLLM does):

```bash
exec > >(tee -a harness/.loop.log) 2>&1
claude -p "$(cat "$PROMPT")" --output-format stream-json --verbose | node harness/bin/stream.mjs
```

`stream.mjs` turns stream-json into one line per tool call (`▸ $ ./y test`, `▸ edit backend/…`).
Without that pipe, `claude -p` prints nothing until an iteration ends. Add
`harness/.loop.log` to the project's `.gitignore`.
