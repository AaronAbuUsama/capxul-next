#!/usr/bin/env python3
"""The mock screens of the run-observability design pack (../README.md).

They are static pages drawn with the portal's own stylesheet, so they look like the portal they will sit in:

    pnpm portal && python3 docs/design/run-observability/mock/build.py packages/portal/dist
    pnpm portal:serve --port 4391        # then open /mock-runs/

Every number, name and sentence on them is read from real runs in var/runs on 10 November 2026
(m1-dev-commands-11101323, m1-dev-commands-11101246-2, m1-dev-commands-11101246, m1-telemetry-11101341,
m1-aws-records-11101341), except what is marked "illustration". Nothing here is product code.
"""
import os, sys

OUT = os.path.join(sys.argv[1], "mock-runs")
os.makedirs(OUT, exist_ok=True)

CSS = """
.mock-flag { font-size: 12px; color: var(--orange); border: 1px dashed var(--orange-line); border-radius: 999px; padding: 1px 10px; }
.illus { font-size: 11px; color: var(--muted); border: 1px dashed var(--line-strong); border-radius: 999px; padding: 0 8px; }
.live { display: inline-flex; align-items: center; gap: 6px; }
.live::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--blue); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.25; } }
.meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--muted); margin: 6px 0 0; }
.ro-btn { font: inherit; font-size: 14px; font-weight: 500; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--line-strong); background: #FFF; color: var(--ink); cursor: pointer; text-decoration: none; display: inline-block; }
.ro-btn-blue { background: var(--blue); border-color: var(--blue); color: #FFF; }
.ro-btn-orange { color: var(--orange); border-color: var(--orange-line); }
.ro-btn[disabled] { color: var(--line-strong); border-color: var(--line); cursor: default; }
.run-card { display: flex; gap: 14px 24px; flex-wrap: wrap; align-items: center; justify-content: space-between; padding: 16px 18px; border: 1px solid var(--blue-line); background: var(--blue-soft); border-radius: 12px; text-decoration: none; color: var(--ink); }
.run-card.wait { border-color: var(--orange-line); background: var(--orange-soft); }
.run-card + .run-card { margin-top: 10px; }
.run-card h3 { font-size: 17px; }
.now { font-family: var(--mono); font-size: 13px; color: var(--body-2); margin-top: 4px; overflow-wrap: anywhere; }
.side { flex: 0 1 300px; min-width: 240px; position: sticky; top: 16px; }
.side h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-family: var(--sans); margin: 0 0 8px; }
.side .rows + h3, .side .tail + h3 { margin-top: 24px; }
.who { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.round { margin-top: 28px; }
.round-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.round-head h2 { font-size: 20px; }
.tl { border-left: 2px solid var(--line); margin-left: 7px; padding-left: 22px; display: flex; flex-direction: column; gap: 12px; }
.step { position: relative; border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; background: #FFF; }
.step::before { content: ""; position: absolute; left: -31px; top: 16px; width: 12px; height: 12px; border-radius: 50%; background: var(--blue); border: 2px solid #FFF; }
.step.is-wait::before { background: var(--line-strong); } .step.is-bad::before { background: var(--orange); }
.step.is-live { border-color: var(--blue-line); box-shadow: 0 0 0 3px var(--blue-soft); }
.step.is-wait { color: var(--muted); background: var(--surface); border-style: dashed; }
.step-head { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.step-name { font-family: var(--mono); font-weight: 500; font-size: 14px; }
.step-kind { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; min-width: 62px; }
.step-open { margin-left: auto; font-size: 13px; }
.step-out { margin-top: 8px; font-size: 14px; line-height: 1.5; color: var(--body-2); }
.step-nums { font-size: 13px; color: var(--muted); }
.opens { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.opens a, .opens span { font-size: 12px; border: 1px solid var(--line); border-radius: 8px; padding: 2px 8px; color: var(--blue); text-decoration: none; background: #FFF; }
.gates { margin-top: 8px; display: grid; gap: 4px; font-size: 13px; }
.gate { display: flex; gap: 10px; align-items: baseline; }
.gate .mark { width: 34px; font-weight: 600; color: var(--blue); } .gate.bad .mark { color: var(--orange); }
.tail { margin: 6px 0 0; padding: 8px 10px; background: #14161A; color: var(--term-fg); border-radius: 8px; font-family: var(--mono); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.finding { margin-top: 8px; padding: 8px 12px; border-left: 3px solid var(--orange); background: var(--orange-soft); color: var(--orange-ink); font-size: 14px; line-height: 1.5; }
.finding .mono { font-size: 12px; }
.handoff { margin: 12px 0 0 29px; padding: 10px 14px; border: 1px solid var(--orange-line); background: var(--orange-soft); color: var(--orange-ink); border-radius: 10px; font-size: 14px; }
.handoff.good { border-color: var(--blue-line); background: var(--blue-soft); color: var(--ink); }
.notice { margin-top: 14px; padding: 12px 16px; border-radius: 10px; border: 1px solid var(--orange-line); background: var(--orange-soft); color: var(--orange-ink); font-size: 14px; }
.notice.quiet { border-color: var(--line); background: var(--surface); color: var(--body-2); }
.tx { display: flex; flex-direction: column; gap: 10px; max-width: 820px; }
.msg { border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; font-size: 14px; line-height: 1.55; }
.msg-label { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.msg.you { align-self: flex-end; max-width: 88%; background: var(--orange-soft); border-color: var(--orange-line); color: var(--orange-ink); }
.msg.agent { border: 0; padding: 2px 2px; font-size: 15px; }
.caret::after { content: "▍"; color: var(--blue); animation: pulse 1s steps(2) infinite; }
.tool { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.tool > summary { list-style: none; display: flex; gap: 10px; align-items: center; padding: 8px 12px; cursor: pointer; font-size: 13px; background: var(--surface); }
.tool > summary::-webkit-details-marker { display: none; }
.tool .cmd { font-family: var(--mono); overflow-wrap: anywhere; flex: 1 1 auto; }
.tool pre { margin: 0; padding: 10px 12px; background: #14161A; color: var(--term-fg); font-family: var(--mono); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.skip { font-size: 13px; color: var(--muted); text-align: center; padding: 2px 0; }
.composer { margin-top: 18px; max-width: 820px; border: 1px solid var(--line-strong); border-radius: 12px; padding: 10px; background: #FFF; }
.composer textarea { width: 100%; border: 0; resize: none; font: inherit; font-size: 15px; min-height: 52px; outline: none; background: transparent; }
.composer-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.hint { font-size: 12px; color: var(--muted); }
.st-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.st-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.st-card h3 { margin-bottom: 6px; }
.st-card p { font-size: 14px; color: var(--body-2); margin-top: 6px; }
.q-card { border: 1px solid var(--orange-line); border-radius: 12px; padding: 16px 18px; background: #FFF; }
@media (max-width: 720px) { .page { padding: 28px 16px 40px; } .title { font-size: 28px; } .side { position: static; flex-basis: 100%; } .step-open { margin-left: 0; } .handoff { margin-left: 0; } }
"""

NAV = [("Overview", "../index.html"), ("Plan", "../plan/index.html"), ("Runs", "index.html"), ("Questions", "questions.html"),
       ("Worlds", "../worlds/index.html"), ("Concepts", "../index.html#concepts"), ("Architecture", "../design/index.html"),
       ("Build", "../build/index.html"), ("Docs", "../docs/index.html")]


def shell(title, active, body):
    def item(name, href):
        count = '<span class="nav-count" style="background:var(--blue)">1</span>' if name == "Runs" else '<span class="nav-count">1</span>' if name == "Questions" else ""
        return f'<a class="nav-item{" is-active" if name == active else ""}" href="{href}">{name}{count}</a>'
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · Capxul portal (mockup)</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500&amp;family=Space+Grotesk:wght@500;600&amp;display=swap">
<link rel="stylesheet" href="../assets/style.css"><style>{CSS}</style></head><body>
<header class="top"><div class="top-in"><a class="brand" href="../index.html"><span class="brand-mark"></span><span class="brand-name">Capxul</span><span class="brand-pill">portal</span></a>
<nav class="nav" aria-label="Sections">{"".join(item(n, h) for n, h in NAV)}</nav><p class="status"><span class="mock-flag">mockup, not built</span></p></div></header>
<main class="page{' with-side' if 'class="side"' in body else ''}">{body}</main></body></html>"""


def write(name, html):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(html)


def step(kind, name, chips="", out="", cls="", link=""):
    more = f'<a class="step-open" href="{link}">open conversation</a>' if link else ""
    return f'<div class="step {cls}"><div class="step-head"><span class="step-kind">{kind}</span><span class="step-name">{name}</span>{chips}{more}</div>{out}</div>'


def gates(rows):
    return '<div class="gates">' + "".join(f'<div class="gate{"" if ok else " bad"}"><span class="mark">{"pass" if ok else "FAIL"}</span><span>{n}</span></div>' for n, ok in rows) + "</div>"


def tool(name, cmd, state, out="", open_=False, cls="chip-quiet"):
    return f'<details class="tool"{" open" if open_ else ""}><summary><span class="chip chip-strong">{name}</span><span class="cmd">{cmd}</span><span class="chip {cls}">{state}</span></summary>{f"<pre>{out}</pre>" if out else ""}</details>'


FOUR = [("book types and tests", True), ("books types", True), ("book builds", True), ("frozen behaviour", True)]
DEV = "Resolve the old dev time and dev snapshot commands against the world commands"

# 1 ── Runs ─────────────────────────────────────────────────────────────────────────────────────
write("index.html", shell("Runs", "Runs", f"""<div class="main-col"><p class="eyebrow">Runs</p><h1 class="title">What the agents are doing</h1>
<p class="lead">Every workflow run. A run is one attempt at one task of the plan: open it for its rounds, each step's output and each agent.</p>
<section class="block"><div class="col-head"><h2>Running now</h2><span class="caption">1 run · 1 agent working · as of 14:11</span></div>
<a class="run-card" href="run-ready.html"><div><h3>Telemetry on every operation, and the record entry as a record</h3>
<p class="meta"><span class="mono">m1-telemetry-11101341</span><span>workflow <b>pair</b></span><span>round 1 of 3</span><span>30m</span><span>3.9M tokens</span></p>
<p class="now"><span class="live">reviewer.1</span> &nbsp;gpt-6.1-terra · 5 turns · reading the change at cf57d96</p></div>
<span class="chip chip-blue">builder handed back · 4 checks pass</span></a></section>
<section class="block"><div class="col-head"><h2>Waiting on a person</h2><span class="caption">blocked runs; each one is a blocked task in the plan</span></div>
<a class="run-card wait" href="run-blocked.html"><div><h3>{DEV}</h3>
<p class="meta"><span class="mono">m1-dev-commands-11101246-2</span><span>workflow <b>pair</b></span><span>3 of 3 rounds</span><span>4m 45s</span><span>197k tokens</span></p>
<p class="now">the builder's model failed in all three rounds; the reviewer's finding was never fixed</p></div>
<span class="chip chip-orange">blocked · with the coordinator</span></a></section>
<section class="block"><div class="col-head"><h2>Finished</h2><span class="caption">the last 24 hours</span></div>
<div class="rows">
<a class="row" href="run-ready.html" style="text-decoration:none;color:inherit"><span class="who"><span class="row-id plain">The AWS side as records: the machine, routes, DNS, backups and a production environment</span><span class="chip chip-blue">ready to merge</span></span><span class="row-text"><span class="mono">m1-aws-records-11101341</span> · pair · 1 round · 21m 01s · 2.77M tokens · ended 14:02</span></a>
<a class="row" href="run-ready.html" style="text-decoration:none;color:inherit"><span class="who"><span class="row-id plain">{DEV}</span><span class="chip chip-blue">merged 792b62b</span></span><span class="row-text"><span class="mono">m1-dev-commands-11101323</span> · pair · 1 round · 13m 37s · 1.77M tokens · ended 13:37</span></a>
<a class="row" href="states.html" style="text-decoration:none;color:inherit"><span class="who"><span class="row-id plain">{DEV}</span><span class="chip chip-orange">failed</span></span><span class="row-text"><span class="mono">m1-dev-commands-11101246</span> · pair · could not make the lane: another run held it · 12:46</span></a>
</div><p class="note">A run with no plan task (a research question, something ad hoc) is listed the same way, under what it was asked instead of a task.</p></section></div>"""))

# 2 ── the plan task and its runs ───────────────────────────────────────────────────────────────
write("task.html", shell("A task and its runs", "Plan", f"""<div class="main-col"><nav class="crumbs"><a href="#">Plan</a><span class="sep">/</span><a href="#">Foundation: the book complete and fit for purpose</a><span class="sep">/</span>m1-dev-commands</nav>
<h1 class="title">{DEV}</h1>
<p class="plan-state"><span class="chip chip-quiet">done</span> <a class="mono" href="run-ready.html">m1-dev-commands-11101323</a> <span class="chip chip-strong">m1</span></p>
<section class="block"><div class="col-head"><h2>Runs</h2><span class="caption">every attempt at this task, newest first; the plan's thread is the newest</span></div>
<div class="rows">
<a class="row" href="run-ready.html" style="text-decoration:none;color:inherit"><span class="who"><span class="row-id plain">Ready in 1 round, then merged</span><span class="chip chip-blue">merged 792b62b</span></span><span class="row-text">13:23 to 13:37 · builder gpt-6.1-sol, reviewer gpt-6.1-terra · 4 checks pass · reviewer approved · 1.77M tokens</span></a>
<a class="row" href="run-blocked.html" style="text-decoration:none;color:inherit"><span class="who"><span class="row-id plain">Blocked after 3 rounds</span><span class="chip chip-orange">blocked</span></span><span class="row-text">12:46 to 12:51 · the builder's model (claude-sonnet-4-6) failed every round · the reviewer asked for changes 3 times · 197k tokens</span></a>
<a class="row" href="states.html" style="text-decoration:none;color:inherit"><span class="who"><span class="row-id plain">Failed at the first step</span><span class="chip chip-orange">failed</span></span><span class="row-text">12:46 · could not make the lane <span class="mono">lane/m1-dev-commands</span>: another run held it</span></a>
</div></section>
<section class="block"><h2>What</h2><div class="md"><p>The book now has two sets of commands for the same thing: the old <code>dev time</code> and <code>dev snapshot</code>, and the new <code>world clock</code> and <code>world snapshot</code>. Keep one.</p></div></section>
<section class="block"><h2>Done when</h2><div class="md"><ul><li>One set remains, the other is classified with a reason, and the frozen check still passes.</li></ul></div></section>
<section class="block"><h2>History</h2><p class="caption">From plan/log.jsonl. An entry the loop wrote links to its run.</p>
<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>By</th><th>Change</th><th>About</th></tr></thead><tbody>
<tr><td class="muted nowrap">12:46</td><td>loop</td><td class="mono">task.start</td><td>run <a class="mono" href="run-blocked.html">m1-dev-commands-11101246-2</a></td></tr>
<tr><td class="muted nowrap">12:51</td><td>loop</td><td class="mono">task.block</td><td>run <a class="mono" href="run-blocked.html">m1-dev-commands-11101246-2</a></td></tr>
<tr><td class="muted nowrap">13:23</td><td>loop</td><td class="mono">task.start</td><td>run <a class="mono" href="run-ready.html">m1-dev-commands-11101323</a></td></tr>
<tr><td class="muted nowrap">13:39</td><td>coordinator</td><td class="mono">task.done</td><td>792b62b</td></tr></tbody></table></div></section>
<section class="block"><h2>In the Plan's task list</h2><p class="caption">The same link sits on the task's row, so the path is: plan, task, its runs, a run, an agent.</p>
<div class="table-wrap"><table class="table"><tbody>
<tr><td><a href="#">Telemetry on every operation, and the record entry as a record</a><span class="cell-sub mono">m1-telemetry</span></td><td><span class="chip chip-blue">doing</span></td><td><a class="live" href="run-ready.html">reviewer.1 working, round 1</a></td></tr>
<tr><td><a href="#">{DEV}</a><span class="cell-sub mono">m1-dev-commands</span></td><td><span class="chip chip-quiet">done</span></td><td class="muted">3 runs</td></tr></tbody></table></div></section></div>"""))

# 3 ── one run, ready in one round (m1-dev-commands-11101323) ────────────────────────────────────
rail_ready = """<aside class="side"><h3>Agents in this run</h3><div class="rows">
<a class="row" href="agent-live.html" style="text-decoration:none;color:inherit"><span class="who"><span class="row-id">make.1</span><span class="chip chip-quiet">done</span></span><span class="row-text">builder · gpt-6.1-sol · writes in the lane</span></a>
<a class="row" href="states.html" style="text-decoration:none;color:inherit"><span class="who"><span class="row-id">reviewer.1.agent</span><span class="chip chip-quiet">done</span></span><span class="row-text">reviewer · gpt-6.1-terra · read-only</span></a></div>
<h3>What it changed</h3><div class="rows">
<div class="row"><span class="row-id plain">12 files, 674 lines added</span><span class="row-text">branch <span class="mono">lane/m1-dev-commands</span> at <span class="mono">b50cae1</span></span></div>
<div class="row"><span class="row-id plain">Records in the blueprint</span><span class="row-text"><a href="../operation/world.clock.set/index.html">world clock set</a> · <a href="../operation/world.snapshot.save/index.html">world snapshot save</a> · <a href="#">6 dev operations, now in the cut</a></span></div></div>
<h3>From a terminal</h3><div class="tail">pnpm loop show m1-dev-commands-11101323 --json</div></aside>"""
write("run-ready.html", shell("One run, ready", "Runs", f"""<div class="main-col"><nav class="crumbs"><a href="index.html">Runs</a><span class="sep">/</span><a href="task.html">m1-dev-commands</a><span class="sep">/</span>m1-dev-commands-11101323</nav>
<h1 class="title">{DEV}</h1>
<p class="plan-state"><span class="chip chip-blue">ready, then merged</span> <span>workflow <b>pair</b></span> <span class="chip chip-strong">1 round of 3</span> <span class="muted">13:23 to 13:37 · 13m 37s · 1.77M tokens</span></p>
<p class="notice quiet">Finished. This run is read-only: its conversations are kept whole, and nothing can be sent to its agents.</p>
<div class="round"><div class="round-head"><h2>Setup</h2></div><div class="tl">
{step("plan", "plan.claim", '<span class="chip chip-quiet">task m1-dev-commands marked started</span>')}
{step("lane", "lane/m1-dev-commands", '<span class="chip chip-quiet">a worktree cut from integration/build</span>')}</div></div>
<div class="round"><div class="round-head"><h2>Round 1</h2><span class="muted">13:23 to 13:37</span></div><div class="tl">
{step("builder", "make.1", '<span class="chip chip-blue">handed back</span><span class="chip chip-quiet">gpt-6.1-sol</span>',
  '<p class="step-nums">10m 33s · 39 turns · 38 tool calls (bash 28, write 5, read 4, edit 1) · 12 refused by policy · 1.63M tokens in, 7.1k out</p>'
  '<p class="step-out"><b>Note.</b> Changed: kept named world commands; classified six frozen dev commands as reached, retired dev time set, archived originals, retained SDK helpers. Ran: 193 pass, 0 fail; both typechecks passed; book 0 problems; frozen 0 breaches.</p>'
  '<p class="step-out"><b>Done.</b> One public world clock/snapshot command surface remains; removed dev operation records are classified and archived.</p>'
  '<div class="opens"><a href="#">the whole hand-back</a><a href="#">commit b50cae1</a><a href="#">diff: 12 files</a></div>', link="agent-live.html")}
{step("gates", "gates.1", '<span class="chip chip-blue">4 of 4 pass</span><span class="step-nums">54s</span>', gates(FOUR) + '<div class="opens"><a href="#">output of each check</a></div>')}
{step("reviewer", "reviewer.1", '<span class="chip chip-blue">approve</span><span class="chip chip-quiet">gpt-6.1-terra</span>',
  '<p class="step-nums">1m 56s · 9 turns · 9 tool calls (bash 6, read 3) · 132k tokens in, 1.0k out</p><p class="step-out">No findings.</p>', link="states.html")}
</div><div class="handoff good"><b>Passed:</b> every check and every reviewer. Nothing goes back to the builder.</div></div>
<div class="round"><div class="round-head"><h2>End</h2></div><div class="tl">
{step("push", "lane/m1-dev-commands", '<span class="chip chip-blue">pushed</span>')}
{step("ready", "every gate and every checker passed", '<span class="chip chip-blue">13:37</span>', '<p class="step-out">Merged by the coordinator at <span class="mono">792b62b</span>, 13:39. The task is done in the plan.</p>')}</div></div></div>{rail_ready}"""))

# 4 ── one run, blocked after three rounds (m1-dev-commands-11101246-2) ─────────────────────────
F1 = "The target operations still book <code>dev time</code> and <code>dev snapshot</code>; the time records also describe <code>dev time set</code>. The supervisor decision names <code>capxul-devnet time</code> and world commands, but does not classify the old command set."
ERR = '<div class="tail">503 auth_unavailable: no auth available (providers=antigravity,claude, model=claude-sonnet-4-6)   ×3\n400 There are no healthy deployments for this model. Received Model Group=claude-sonnet-4-6</div>'


def blocked_round(n, when, rev_nums, findings, back):
    err = ERR if n == 1 else '<div class="tail">400 There are no healthy deployments for this model. Received Model Group=claude-sonnet-4-6</div>'
    return f"""<div class="round"><div class="round-head"><h2>Round {n}</h2><span class="muted">{when}</span></div><div class="tl">
{step("builder", f"make.{n}", '<span class="chip chip-orange">model error</span><span class="chip chip-quiet">claude-sonnet-4-6</span>', f'<p class="step-nums">no turn completed · 0 tokens · nothing was changed</p>{err}', "is-bad", "states.html")}
{step("gates", f"gates.{n}", '<span class="chip chip-blue">4 of 4 pass</span>', '<p class="step-out">The checks pass because the lane is unchanged from <span class="mono">a557318</span>.</p>')}
{step("reviewer", f"reviewer.{n}", '<span class="chip chip-orange">changes</span><span class="chip chip-quiet">gpt-6-luna</span>', f'<p class="step-nums">{rev_nums}</p>{findings}', "is-bad", "states.html")}
</div><div class="handoff"><b>Back to the builder:</b> {back}</div></div>"""


find1 = f'<div class="finding"><b>F-1.1 blocking</b> · <span class="mono">books/target/devnet/operations.ts:41</span><br>{F1}</div>'
find2 = '<div class="finding"><b>F-2.1, F-2.2 blocking</b> · <span class="mono">books/target/devnet/operations.ts:41</span><br>The diff is empty (<code>from</code> and <code>to</code> are the same commit), so no change addresses the open classification finding.</div>'
find3 = '<div class="finding"><b>F-3.1, F-3.2 blocking</b> · <span class="mono">books/target/devnet/operations.ts:41</span><br>The diff from this version to itself is empty, and the operations book still defines <code>dev time</code>, <code>dev time set</code> and <code>dev snapshot</code> without classifying the competing command set.</div>'
write("run-blocked.html", shell("One run, blocked", "Runs", f"""<div class="main-col"><nav class="crumbs"><a href="index.html">Runs</a><span class="sep">/</span><a href="task.html">m1-dev-commands</a><span class="sep">/</span>m1-dev-commands-11101246-2</nav>
<h1 class="title">{DEV}</h1>
<p class="plan-state"><span class="chip chip-orange">blocked</span> <span>workflow <b>pair</b></span> <span class="chip chip-strong">3 rounds of 3</span> <span class="muted">12:46 to 12:51 · 4m 45s · 197k tokens</span></p>
<p class="notice"><b>Blocked, waiting on a person.</b> The rounds ran out with 6 findings open. The plan task is blocked for the coordinator, who answers it or brings it to you in <a href="questions.html">Questions</a>. Read first: the builder never ran. Its model failed in every round, so the reviewer read an empty change three times.</p>
<div class="round"><div class="round-head"><h2>Setup</h2></div><div class="tl">
{step("plan", "plan.claim", '<span class="chip chip-quiet">task m1-dev-commands marked started</span>')}
{step("lane", "lane/m1-dev-commands", '<span class="chip chip-quiet">a worktree cut from integration/build at a557318</span>')}</div></div>
{blocked_round(1, "12:47 to 12:49", "1m 25s · 7 turns · 11 tool calls (read 6, bash 5) · 149k tokens in, 963 out", find1, "2 findings: F-1.1 from the reviewer, F-1.0 the builder did not finish (model error).")}
{blocked_round(2, "12:49 to 12:50", "9s · 3 turns · 4 tool calls (bash 4) · 31k tokens in, 618 out", find2, "5 findings open: the 2 from round 1, F-2.1 and F-2.2 from the reviewer, F-2.0 the builder did not finish.")}
{blocked_round(3, "12:50 to 12:51", "6s · 2 turns · 6 tool calls (read 4, bash 2) · 14k tokens in, 714 out", find3, "out of rounds.")}
<div class="round"><div class="round-head"><h2>End</h2></div><div class="tl">
{step("plan", "plan.block", '<span class="chip chip-orange">task blocked for the coordinator</span>', cls="is-bad")}
{step("blocked", "6 findings open", '<span class="chip chip-orange">12:51</span>', '<div class="opens"><a href="#">all 6 findings</a><a href="questions.html">the question it became</a></div>', "is-bad")}</div></div></div>
<aside class="side"><h3>Agents in this run</h3><div class="rows">
<div class="row"><span class="who"><span class="row-id">make.1 · make.2 · make.3</span><span class="chip chip-orange">model error</span></span><span class="row-text">builder · claude-sonnet-4-6 · never answered</span></div>
<div class="row"><span class="who"><span class="row-id">reviewer.1 to .3</span><span class="chip chip-quiet">done</span></span><span class="row-text">reviewer · gpt-6-luna · read-only · changes ×3</span></div></div>
<h3>What it changed</h3><div class="rows"><div class="row"><span class="row-id plain">Nothing</span><span class="row-text">the lane is still at <span class="mono">a557318</span></span></div></div>
<h3>To try again</h3><div class="tail">pnpm loop run m1-dev-commands</div></aside>"""))

# 5 ── inside one agent, live (make.1 of m1-dev-commands-11101323, as it stood at 13:26) ────────
write("agent-live.html", shell("Inside one agent", "Runs", f"""<div class="main-col"><nav class="crumbs"><a href="index.html">Runs</a><span class="sep">/</span><a href="run-ready.html">m1-dev-commands-11101323</a><span class="sep">/</span>make.1</nav>
<h1 class="title">make.1 <span class="muted" style="font-size:20px;font-family:var(--sans);font-weight:400">builder</span></h1>
<p class="plan-state"><span class="chip chip-blue live">working</span> <span class="chip chip-quiet">gpt-6.1-sol</span> <span class="muted">round 1 · 11 turns · 10 tool calls · 212k tokens in · tools: read, write, edit, bash · in <span class="mono">lane/m1-dev-commands</span></span> <span class="illus">replayed from the stored conversation, as at 13:26</span></p>
<section class="block" style="margin-top:28px"><div class="tx">
<details class="tool"><summary><span class="chip chip-strong">input</span><span class="cmd" style="font-family:var(--sans)">Task <b>m1-dev-commands</b>, round 1 of the run · the goal, the brief, the ground rules</span><span class="chip chip-quiet">from the workflow</span></summary></details>
{tool("bash", "pwd; git status --short; cat CLAUDE.md", "ok")}
{tool("bash", "cat START-HERE.md; cat HANDOFF.md; cat docs/design-book.md; cat books/target/CONVENTIONS.md", "ok")}
{tool("bash", "cat books/target/devnet/index.ts; rg -n 'dev_time|dev_snapshot|world_clock|world_snapshot' books/target/devnet/operations.ts", "refused", "Tool call blocked: Refused by the loop's policy: `rg -n 'dev_time` is not a command this agent may run", True, "chip-orange")}
{tool("bash", "cat books/target/devnet/index.ts; grep -n dev_time books/target/devnet/operations.ts; grep -n dev_snapshot books/target/devnet/operations.ts", "ok")}
<p class="skip">3 more tool calls</p>
{tool("read", "books/target/devnet/operations.ts · lines 1 to 260", "ok")}
{tool("read", "books/target/devnet/world-ops.ts · lines 1 to 240", "ok")}
<div class="msg you"><div class="msg-label">You · steer · 13:26 <span class="illus">illustration</span></div>Do not choose the surviving command set without an existing ruling.</div>
{tool("bash", "grep -n operation_dev_time books/target/devnet/decisions.ts; grep -n operation_dev_snapshot books/target/devnet/decisions.ts", "running…", cls="chip-blue")}
</div>
<div class="composer"><textarea placeholder="Say something to make.1"></textarea>
<div class="composer-row"><span class="hint">Steer joins after its current tool call. Queue waits for this turn to end.</span>
<span style="display:flex;gap:8px;flex-wrap:wrap"><button class="ro-btn ro-btn-orange">Stop agent</button><button class="ro-btn">Queue</button><button class="ro-btn ro-btn-blue">Steer</button></span></div></div>
</section></div>"""))

# 6 ── the states ───────────────────────────────────────────────────────────────────────────────
dead = '<div class="composer" style="margin-top:10px;background:var(--surface)"><div class="composer-row"><span class="hint">{}</span><span style="display:flex;gap:8px"><button class="ro-btn" disabled>Queue</button><button class="ro-btn" disabled>Steer</button></span></div></div>'
write("states.html", shell("The states of a run", "Runs", f"""<div class="main-col"><p class="eyebrow">Runs</p><h1 class="title">The five states, and what you can do in each</h1>
<p class="lead">The same run and agent pages, in each state a run can be in. Blue is working or done; orange needs a person; grey is past.</p>
<section class="block"><div class="st-grid">
<div class="st-card"><h3><span class="chip chip-blue live">running</span> Live</h3><p>The host owns the run and you are attached to it. Text appears as the agent writes it.</p><p><b>You can:</b> steer, queue, stop the agent, stop the run.</p><p class="row-text">Real: m1-telemetry-11101341 at 14:11.</p></div>
<div class="st-card"><h3><span class="chip chip-orange">offline</span> The owner is gone</h3><p>The run says running but the process that owned it has died. You see everything it stored, up to the last second.</p><p><b>You can:</b> read. Nothing can be sent until it is resumed.</p>{dead.format("Offline. Resume it from a terminal: pnpm loop resume &lt;run&gt;")}<p class="row-text"><span class="illus">illustration</span> today the terminal shows this as "dead (resume)".</p></div>
<div class="st-card"><h3><span class="chip chip-quiet">ready</span> <span class="chip chip-quiet">merged</span> <span class="chip chip-quiet">answered</span> Finished</h3><p>The run ended by itself. It is opened read-only; the conversations are kept whole.</p><p><b>You can:</b> read, open every step's output, follow the links to the task, the branch and the records.</p>{dead.format("Finished: nothing can be sent to this agent.")}<p class="row-text">Real: m1-dev-commands-11101323.</p></div>
<div class="st-card"><h3><span class="chip chip-orange">blocked</span> Waiting on a person</h3><p>The run stopped with a reason: the rounds ran out, or the builder asked a question it may not answer itself.</p><p><b>You can:</b> read why, and answer in Questions once the coordinator brings it to you. A new run starts after the answer.</p><p class="row-text">Real: m1-dev-commands-11101246-2.</p></div>
<div class="st-card"><h3><span class="chip chip-orange">failed</span> <span class="chip chip-quiet">stopped</span> Failed or stopped</h3><p>A step threw, or someone stopped it. The error is the first thing on the page.</p><div class="tail">cannot make the lane lane/m1-dev-commands: 'lane/m1-dev-commands' is already used by worktree at … If another run holds it, `pnpm loop clean &lt;run&gt;` first.</div><p><b>You can:</b> read, then resume or start again from a terminal.</p><p class="row-text">Real: m1-dev-commands-11101246.</p></div>
</div></section>
<section class="block"><h2>A finished agent</h2><p class="caption">reviewer.1.agent of m1-dev-commands-11101323: the same conversation page, read-only.</p><div class="tx">
<details class="tool"><summary><span class="chip chip-strong">input</span><span class="cmd" style="font-family:var(--sans)">Check <b>m1-dev-commands</b> at b50cae1, round 1 · the goal, the machine verdicts, the builder's note</span><span class="chip chip-quiet">from the workflow</span></summary></details>
{tool("bash", "git diff a557318..b50cae1", "ok")}
<p class="skip">8 more tool calls</p>
<div class="msg agent"><b>Verdict: approve.</b> No findings.</div></div>{dead.format("Finished 13:37 · 9 turns · 132k tokens in, 1.0k out")}</section></div>"""))

# 7 ── how a blocked run joins Questions ────────────────────────────────────────────────────────
write("questions.html", shell("Questions", "Questions", f"""<div class="main-col"><div class="q-head"><div><h1 class="title-wide">Questions that need you</h1>
<p class="q-lead">Everything that waits on you, in one list: the decisions only you can make, and the tasks of the plan that need something only you can do or say.</p></div><p class="q-count"><span class="q-count-big">1</span> waiting</p></div>
<section class="block" style="margin-top:28px"><div class="q-card"><p class="eyebrow eyebrow-orange">Task blocked · m1-dev-commands</p>
<h2 style="margin:6px 0 8px">Which command set remains: <span class="mono" style="font-size:0.9em">dev time</span> or <span class="mono" style="font-size:0.9em">world clock</span>?</h2>
<p class="caption" style="margin:0 0 10px">The coordinator brought this to you after a run blocked on it. <span class="illus">illustration: this run was in fact unblocked by a second run</span></p>
<div class="rows"><a class="row" href="run-blocked.html" style="text-decoration:none;color:inherit"><span class="who"><span class="row-id plain">The run that blocked</span><span class="chip chip-orange">3 rounds, 6 findings</span></span><span class="row-text">m1-dev-commands-11101246-2 · open it to read the reviewer's findings and each agent's conversation</span></a></div>
<div class="composer" style="max-width:none"><textarea placeholder="Your answer"></textarea><div class="composer-row"><span class="hint">Saved to plan/answers.jsonl. The coordinator applies it, then starts a new run.</span><button class="ro-btn ro-btn-blue">Save answer</button></div></div></div></section></div>"""))
print("wrote", ", ".join(sorted(os.listdir(OUT))))
