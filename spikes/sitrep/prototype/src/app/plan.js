// Plan: the written plan, its state and burn-down, then its milestones. A milestone's page groups its steps Moving
// and Not started, with Done folded; a step's page shows what it needs (linked), its lane, proof, pull requests and
// the ratchet it closes. Each ends with its history.

const stepsOf = (m) => (m.fields.steps || []).map((id) => IX.steps[id]).filter(Boolean);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const ratchetsClosing = (stepId) =>
  SNAP.derived.measures.ratchets.filter((r) => String(r.closes).split(/[ ,]+/).includes(stepId));

function StepRow({ step, rel }) {
  const lane = laneOfStep(step.id);
  return html`<${Row} onClick=${() => nav.push({ kind: "step", id: step.id })} dim=${step.state === "done" && !rel}
    lead=${html`<span class="mono step-id">${step.id}</span>`}
    title=${rel ? html`<span class="rel">${rel}</span>${step.fields.title}` : step.fields.title}
    meta=${html`<${Chip} s=${step.state} />${lane ? html`<span>${lane.fields.title}</span>` : null}${step.state !== "planned" ? html`<span>${ago(step.since)}</span>` : null}`} />`;
}

function MilestoneRow({ m }) {
  return html`<${Row} onClick=${() => nav.push({ kind: "milestone", id: m.id })}
    lead=${html`<span class=${"ring" + (m.done === m.of && m.of ? " done" : "")} style=${"--p:" + pct(m.done, m.of)} aria-hidden="true">${m.done === m.of && m.of ? html`<${Icon} n="check" sm />` : null}</span>`}
    title=${m.fields.title}
    meta=${html`<${Chip} s=${m.done === m.of && m.of ? "done" : m.state} /><span>Milestone ${m.id}</span><span class="num">${m.done} of ${m.of} units</span>`}
    label=${"Milestone " + m.id + ": " + m.fields.title} />`;
}

function PlanScreen() {
  useStore();
  const p = SNAP.plan, f = p.fields;
  const agreed = [...p.history].reverse().find((e) => e.event === "plan_agreed");
  const ms = f.milestones.map((id) => IX.milestones[id]).filter(Boolean);
  const src = SourceFoot({ source: "roadmap" });
  return html`<${Page} title=${f.title} pageKey="plan"
    sub=${html`<${Chip} s=${p.state} label=${p.state === "agreed" && agreed ? "Agreed by " + who(agreed.by).name + ", " + clock(agreed.at) : null} />`}>
    <${Prose} parts=${[["Why", f.why], ["What", f.what], ["Where it ends", f.endState], ["What it leaves out", f.outOfScope]]} />
    <${Section} title="Progress" id="sec-burn" ...${src}>
      <${BurnCard} series=${SNAP.burn} label="The whole plan's burn-down" />
    </${Section}>
    <${Section} title="Milestones" count=${ms.length} id="sec-ms">
      <div class="group">${ms.map((m) => html`<${MilestoneRow} m=${m} key=${m.id} />`)}</div>
    </${Section}>
    <${History} entries=${historyOf("plan", p)} id="plan" />
  </${Page}>`;
}

function MilestonePage({ id, back }) {
  const m = IX.milestones[id], f = m.fields;
  const steps = stepsOf(m);
  const moving = steps.filter((s) => s.state === "active");
  const waiting = steps.filter((s) => s.state === "planned");
  const done = steps.filter((s) => s.state === "done" || s.state === "dropped");
  return html`<${Page} title=${f.title} back=${back} pageKey=${"m" + id}
    sub=${html`<${Chip} s=${m.done === m.of && m.of ? "done" : m.state} /><span>Milestone ${m.id}</span>`}>
    <${Prose} parts=${[["Goal", f.goal], ["Why now", f.why], ["Done when", f.doneWhen]]} />
    <div class="card">
      <div class="section-head"><span class="eyebrow">Progress</span><span class="num ink2">${m.done} of ${m.of} units · ${pct(m.done, m.of)}%</span></div>
      <div class=${"bar" + (m.done === m.of ? " good" : "")} role="progressbar" aria-valuenow=${m.done} aria-valuemax=${m.of} aria-label="Units done"><i style=${"width:" + pct(m.done, m.of) + "%"}></i></div>
    </div>
    <${Section} title="Burn-down" id=${"sec-burn-" + id}><${BurnCard} steps=${steps} label=${"Milestone " + id + " burn-down"} /></${Section}>
    ${moving.length ? html`<${Section} title="Moving" count=${moving.length} id=${"sec-moving-" + id}><div class="group">${moving.map((s) => html`<${StepRow} step=${s} key=${s.id} />`)}</div></${Section}>` : null}
    ${waiting.length ? html`<${Section} title="Not started" count=${waiting.length} id=${"sec-wait-" + id}><div class="group">${waiting.map((s) => html`<${StepRow} step=${s} key=${s.id} />`)}</div></${Section}>` : null}
    ${done.length ? html`<${Fold} label=${"Done (" + done.length + ")"} id=${"done-" + id} open=${!moving.length && !waiting.length}>
      <div class="group">${done.map((s) => html`<${StepRow} step=${s} key=${s.id} />`)}</div>
    </${Fold}>` : null}
    <${History} entries=${historyOf("milestone", m)} id=${"m" + id} />
  </${Page}>`;
}

function StepPage({ id, back }) {
  const s = IX.steps[id], f = s.fields;
  const lane = laneOfStep(id);
  const pulls = lane ? SNAP.derived.pulls.filter((p) => p.lane === lane.id) : [];
  const ratchets = ratchetsClosing(id);
  const ms = IX.milestones[f.milestone];
  return html`<${Page} title=${f.title} back=${back} pageKey=${"s" + id}
    sub=${html`<${Chip} s=${s.state} /><span>Step ${id}</span>${ms ? html`<span>${ms.fields.title}</span>` : null}<span>${plural(f.units || 1, "unit")}</span>`}>
    <${Prose} parts=${[["What", f.what], ["Why", f.why], ["Done when", f.doneWhen]]} />
    <${Section} title="Needs" count=${(f.needs || []).length || null} id=${"sec-needs-" + id}>
      ${(f.needs || []).length ? html`<div class="group">${f.needs.map((n) => IX.steps[n]).filter(Boolean).map((n) => html`<${StepRow} step=${n} key=${n.id} rel=${n.state === "done" ? "Needed, done" : "Waiting on"} />`)}</div>`
        : html`<p class="section-foot">Needs no other step.</p>`}
    </${Section}>
    <${Section} title="Lane" id=${"sec-lane-" + id}>
      ${lane ? html`<div class="group"><${Row} onClick=${() => nav.push({ kind: "lane", id: lane.id })} lead=${html`<${Lead}>${threadLabel(lane.fields.lead).emoji}</${Lead}>`}
        title=${lane.fields.title} meta=${html`<span class="mono">${lane.fields.branch}</span>`} /></div>` : html`<p class="section-foot">No lane has taken it yet.</p>`}
    </${Section}>
    <${Section} title="Proof" id=${"sec-proof-" + id}>
      ${f.proof ? html`<div class="group"><${Row} href=${f.proof} lead=${html`<${Lead} tone="good"><${Icon} n="check" /></${Lead}>`} title="Proof on master" meta=${html`<span class="mono">${f.proof.split("/").pop()}</span>`} /></div>`
        : html`<p class="section-foot">No proof yet. It is proven when CI commits one.</p>`}
    </${Section}>
    ${pulls.length ? html`<${Section} title="Pull requests" count=${pulls.length} id=${"sec-prs-" + id}><div class="group">${pulls.map((p) => html`<${PullRow} p=${p} key=${p.number} />`)}</div></${Section}>` : null}
    ${ratchets.length ? html`<${Section} title="Closes" id=${"sec-ratchet-" + id}><div class="group">${ratchets.map((r) => html`<${Row} key=${r.id}
      lead=${html`<${Lead} tone="accent"><span class="mono">${r.id}</span></${Lead}>`} title=${r.name} meta=${html`<span>${r.count != null ? r.count + " left" : "Not counted yet"}</span>`} />`)}</div></${Section}>` : null}
    <${History} entries=${historyOf("step", s)} id=${"s" + id} />
  </${Page}>`;
}

const PR_TONE = { open: "accent", draft: "", merged: "good", closed: "" };
const PullRow = ({ p }) => html`<${Row} href=${p.href} lead=${html`<${Lead} tone=${PR_TONE[p.state]}><${Icon} n="pr" /></${Lead}>`}
  title=${p.title} meta=${html`<span class=${"chip " + (PR_TONE[p.state] || "")}><span class="dot"></span>${cap(p.state)}</span><span class="mono">#${p.number}</span>`} />`;
