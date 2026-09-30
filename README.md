# harness-viz

A live dashboard for repos that build themselves with an agent loop. It shows the task graph as
it moves (ready → doing → done), what the current iteration is doing right now, and — when
the loop has stopped — **why** it stopped. It can start and stop the loop from the page.

![harness-viz in dark mode, showing a stalled task and the reason the loop stopped](docs/screenshot-dark.png)

It's built for the "harness" pattern: `specs/` that say what's true, a task graph of small
verifiable tasks in `harness/graph/`, and a loop script that runs one fresh
[Claude Code](https://docs.anthropic.com/en/docs/claude-code) `claude -p` per task (the
[Ralph](https://github.com/ghuntley/how-to-ralph-wiggum) technique, plus a graph and gates).

Zero dependencies: Node's `http` module, server-sent events and one static page.

## Try it

```bash
git clone https://github.com/<you>/harness-viz && cd harness-viz
node bin/harness-viz.mjs open examples/demo
```

`examples/demo` is a made-up recipe-site project whose loop stopped after two iterations
without progress. Its `loop.sh` is a **simulation** — it prints the same log format as a real
loop but never calls Claude — so the play and stop buttons are safe to try.

Requires Node 20+. Tested on macOS; Linux should work (loop detection uses `ps` and `lsof`).

## Use it on your projects

```bash
node bin/harness-viz.mjs                  # serve on http://127.0.0.1:4545
node bin/harness-viz.mjs open ~/src/app   # start the server if needed, open that project
node bin/harness-viz.mjs add ~/src/app    # register a project (list | remove work too)
```

Any subfolder of `~/code` that contains `harness/graph/` shows up as a tab on its own. Point
discovery elsewhere with `HARNESS_VIZ_DISCOVER=~/src:~/work` (a `:`-separated list).

### What a project needs

| Path | What harness-viz reads |
| --- | --- |
| `harness/graph/<id>.md` | One task per file: YAML frontmatter + a markdown brief. Required: `id`, `title`, `status` (`todo` · `doing` · `done` · `blocked` · `dropped`), `owner` (`agent` · `human`). Optional: `phase`, `priority`, `depends_on`, `acceptance`, `verify`, `spec`, `notes`. |
| `harness/.loop.log` | The loop's output (gitignore it). Tailed live. |
| `harness/bin/loop.sh` | Optional. If present, the ▶ button runs `loop.sh <mode> <iterations>`. |
| `harness/prompts/<mode>.md` | Optional. Each file is a mode the ▶ popover offers (`build`, `plan`, …). |

The frontmatter parser is a small YAML subset: scalars, inline arrays (`[a, b]`) and dash lists.

Status meanings: `doing` is a lock held by the task being worked on. `blocked` needs a
`notes:` saying why. `dropped` means superseded by a change of direction — terminal but not
done, so it's left out of "x / y done". `owner: human` marks gates the loop can't pass
(credentials, taste, DNS); they're dashed purple with a "you" tag.

### The loop log

harness-viz understands these lines (all optional; anything else is shown as-is):

```text
════ 2026-09-28 09:14:02 ════          a run starts
── loop: mode=build max=10 ──
── iteration 3/10 ─────────             an iteration starts
09:27:37  ▸ read specs/site.md          a tool call: ▸ read|edit|write|grep|$ <command>|subagent …
09:27:36  » Resuming from the notes.    something the agent said
09:33:31  ✗ build failed                an error
09:35:02  agent finished: success in 449s, 120 turns
```

and these ways a run can end, which become the "why it stopped" text:

| Line | Shown as |
| --- | --- |
| `── reached iteration cap ──` | Hit its iteration cap |
| `nothing left for the agent — stopping.` | Waiting on you (only human tasks are ready) |
| `two iterations without progress — stopping …` | Stopped: no progress |
| `graph is unhappy (exit N)` | Stopped: graph is invalid |
| `── stopped from harness-viz ──` | Stopped by you (written when you press ■) |
| *(none, and no process)* | Interrupted — killed, Ctrl-C, or a closed terminal |

To get one line per tool call, copy [`kit/stream.mjs`](kit/stream.mjs) into your project's
`harness/bin/` and pipe Claude Code's stream-json through it inside `loop.sh`:

```bash
exec > >(tee -a harness/.loop.log) 2>&1     # everything the loop prints also lands in the log
claude -p "$(cat "$PROMPT")" --output-format stream-json --verbose | node harness/bin/stream.mjs
```

## What you see

| Area | Shows |
| --- | --- |
| Loop card | **Building** (a loop is running and a task is in `doing`), **Running · between tasks**, **Stalled** (a task is in `doing` but nothing is running — with the reason and the task's notes), or **Idle** |
| Progress | done / doing / ready / blocked / waiting, with dropped counted separately |
| Waiting on you | ready human tasks, and blocked tasks with their notes |
| Graph | the DAG left to right by dependency depth. Opens zoomed on the active task; ⤢ fits everything. Click a task for its brief, acceptance, verify, spec and notes |
| Dock | Orient → Implement → Verify → Commit for the current iteration, inferred from its tool calls, and a lane of those calls |
| Controls | ▶ opens a popover to pick the mode and number of iterations. ■ stops a running loop after a confirm. Zoom, fit and follow |
| Inspector | the selected task, recent commits (`task(<id>): …` commits link to their task), and the raw loop log |

**Is a loop actually running?** A task file saying `doing` only means an iteration took the
lock; if the loop then hit its cap or was killed, nothing releases it. So harness-viz looks for
the process: a `loop.sh` (or `claude -p`) whose working directory is the project root. It
doesn't go by the log's modification time — a long build can leave the log quiet for minutes
while the loop is fine, and a loop killed seconds ago still has a fresh log.

**Motion.** Current flows along the edges into the task being built, tool calls float up off
its node, a finished task bursts green and newly unlocked tasks glow. With Follow on, the
camera glides to whatever is being built. All of it is off under `prefers-reduced-motion`.

Light and dark themes follow the system; the header toggle overrides it.

## Security

The page shows private plans and can start processes, so:

- The server binds **127.0.0.1 only**, and rejects requests whose `Host` isn't
  `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding protection).
- Start/stop are `POST`s that must carry an `X-Harness-Viz` header and a same-origin `Origin`.
  A web page on another site can't send that header without a CORS preflight, which the server
  never approves.
- Starting runs only the project's own `harness/bin/loop.sh`, with a mode that must match a file
  in `harness/prompts/` and an iteration count from 1 to 200.
- Stopping sends SIGTERM (then SIGKILL) to that project's loop and everything it started, and
  appends one line to its `.loop.log`. Nothing else in a project is ever written.
- `serve --read-only` turns the controls off entirely.

A loop started from the page keeps running if the server stops. Whatever `loop.sh` grants the
agent (for example `--permission-mode acceptEdits`) is the real trust decision; harness-viz
just presses the button.

## Configuration

| | |
| --- | --- |
| `--port 4600` | port for `serve`, `open`, `install` (default 4545) |
| `--read-only` | no start/stop controls |
| `HARNESS_VIZ_DISCOVER` | folders to scan for projects (default `~/code`) |
| `HARNESS_VIZ_CONFIG` | where the registry lives (default `~/.config/harness-viz`) |

### Run at login (macOS, optional)

```bash
node bin/harness-viz.mjs install     # LaunchAgent dev.harness-viz (add --read-only if you like)
node bin/harness-viz.mjs status
node bin/harness-viz.mjs uninstall
```

`install` writes `~/Library/LaunchAgents/dev.harness-viz.plist` (RunAtLoad, KeepAlive) and logs
to `~/Library/Logs/harness-viz.log`.

## Credits

The visual direction follows RonDesignLab's
[PicGen dashboard shot](https://dribbble.com/shots/26824576-PicGen-SaaS-Image-Generator-Dashboard).
The bundled [Outfit](https://github.com/Outfitio/Outfit-Fonts) typeface is under the SIL Open
Font License (`public/fonts/OFL.txt`).

![harness-viz in light mode](docs/screenshot-light.png)

## License

MIT — see [LICENSE](LICENSE).
