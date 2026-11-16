// Lanes: one row per lane, like an agent's session (its lead, its current step, its pull request, its age). A lane's
// page has its lead, steps, pull requests, threads, sitreps and history. Measures: ratchets, the run's budget, evals.

function laneFacts(l) {
  const steps = (l.fields.steps || []).map((id) => IX.steps[id]).filter(Boolean);
  const current = steps.find((s) => s.state === "active") || steps.find((s) => s.state === "planned") || steps[steps.length - 1];
  const pulls = SNAP.derived.pulls.filter((p) => p.lane === l.id);
  const slice = pulls.find((p) => /^slice\//.test(p.title));
  const threads = SNAP.threads.filter((t) => t.fields.lane === l.id);
  const latest = [l.since, ...threads.map((t) => t.since), ...steps.map((s) => s.since)].sort().pop();
  return { steps, current, pulls, slice, threads, latest };
}

function LanesScreen() {
  useStore();
  const lanes = SNAP.lanes;
  const loose = SNAP.threads.filter((t) => !t.fields.lane);
  const cond = SourceFoot({ source: "conductor" });
  return html`<${Page} title="Lanes" pageKey="lanes" sub=${plural(lanes.filter((l) => l.state === "open").length, "lane") + " open · " + plural(SNAP.threads.filter((t) => t.state !== "archived").length, "thread") + " working"}>
    <${Section} title="Lanes" count=${lanes.length} id="sec-lanes" ...${cond}>
      <div class="group">
        ${lanes.map((l) => {
          const x = laneFacts(l);
          const lead = l.fields.lead ? IX.threads[l.fields.lead] : null;
          return html`<${Row} key=${l.id} cls="lane-row" onClick=${() => nav.push({ kind: "lane", id: l.id })}
            lead=${html`<${Lead} tone=${lead && lead.state === "waiting" ? "warn" : "accent"}>${lead ? THREAD_TYPES[lead.fields.type] : html`<${Icon} n="lanes" />`}</${Lead}>`}
            title=${l.fields.title}
            meta=${html`${x.current ? html`<span>Step ${x.current.id}</span>` : null}
              ${lead && lead.state === "waiting" ? html`<${Chip} s="waiting" />` : lead ? null : html`<span class="chip warn"><span class="dot"></span>No lead</span>`}
              ${x.slice ? html`<span class="mono">#${x.slice.number}</span>` : null}`}
            end=${html`<span class="num">${ago(x.latest, true)}</span>`} />`;
        })}
      </div>
    </${Section}>
    <${Section} title="Other threads" count=${loose.length} id="sec-threads">
      <div class="group">${loose.map((t) => html`<${ThreadRow} t=${t} key=${t.id} />`)}</div>
    </${Section}>
  </${Page}>`;
}

const ThreadRow = ({ t }) => html`<${Row} href=${t.fields.link} lead=${html`<${Lead}>${THREAD_TYPES[t.fields.type] || "🤖"}</${Lead}>`}
  title=${t.fields.title} meta=${html`<${Chip} s=${t.state === "active" ? "active" : t.state} label=${t.state === "active" ? "Working" : null} /><span>${cap(t.fields.type)}</span><span>${ago(t.since)}</span>`} />`;

function LanePage({ id, back }) {
  const l = IX.lanes[id];
  const x = laneFacts(l);
  const lead = l.fields.lead ? IX.threads[l.fields.lead] : null;
  const reps = SNAP.sitreps.filter((s) => (s.fields.lanes || []).includes(id)).sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  const others = x.threads.filter((t) => t.id !== l.fields.lead);
  return html`<${Page} title=${l.fields.title} back=${back} pageKey=${"l" + id} sub=${html`<${Chip} s=${l.state} /><span class="mono">${l.fields.branch}</span>`}>
    <${Section} title="Lead" id=${"sec-lead-" + id}>
      ${lead ? html`<div class="group"><${ThreadRow} t=${lead} /></div>` : html`<p class="section-foot">No lead has started on this lane yet.</p>`}
    </${Section}>
    <${Section} title="Steps" count=${x.steps.length} id=${"sec-lsteps-" + id}><div class="group">${x.steps.map((s) => html`<${StepRow} step=${s} key=${s.id} />`)}</div></${Section}>
    <${Section} title="Pull requests" count=${x.pulls.length} id=${"sec-lprs-" + id}>
      ${x.pulls.length ? html`<div class="group">${x.pulls.map((p) => html`<${PullRow} p=${p} key=${p.number} />`)}</div>` : html`<p class="section-foot">No pull requests yet.</p>`}
    </${Section}>
    ${others.length ? html`<${Section} title="Threads" count=${others.length} id=${"sec-lthreads-" + id}><div class="group">${others.map((t) => html`<${ThreadRow} t=${t} key=${t.id} />`)}</div></${Section}>` : null}
    ${reps.length ? html`<${Section} title="Sitreps" count=${reps.length} id=${"sec-lreps-" + id}><div class="group">${reps.map((s) => html`<${Row} key=${s.id}
      onClick=${() => { store.set({ openSitrep: s.id }); nav.tab("sitreps"); }} dim=${stateOf("sitrep", s) === "heard"}
      lead=${stateOf("sitrep", s) === "heard" ? html`<${Lead}><${Icon} n="check" sm /></${Lead}>` : html`<${Lead} tone="accent"><${Icon} n="sitreps" sm /></${Lead}>`}
      title=${s.fields.title} meta=${html`<span>${when(s.since)}</span>`} />`)}</div></${Section}>` : null}
    <${History} entries=${historyOf("lane", l)} id=${"l" + id} />
  </${Page}>`;
}

function verdictOf(r) {
  const s = r.series || [];
  if (s.length < 2) return { text: "One reading so far", tone: "" };
  const today = s.filter((p) => dayLabel(p.at) === "Today");
  const base = (today.length > 1 ? today : s)[0].count, d = s[s.length - 1].count - base;
  const span = today.length > 1 ? " today" : "";
  if (d < 0) return { text: "Down " + -d + span, tone: "good" };
  if (d > 0) return { text: "Up " + d + span, tone: "bad" };
  return { text: "Flat" + span, tone: "" };
}

function MeasuresScreen() {
  const rs = SNAP.derived.measures.ratchets;
  const counted = rs.filter((r) => r.count != null), uncounted = rs.filter((r) => r.count == null);
  const gh = SourceFoot({ source: "github" });
  return html`<${Page} title="Measures" pageKey="measures" sub=${plural(counted.length, "ratchet") + " counted · " + uncounted.length + " not yet"}>
    <${Section} title="Ratchets" count=${counted.length} id="sec-ratchets">
      <div class="cards">${counted.map((r) => {
        const v = verdictOf(r);
        return html`<div class="trend" key=${r.id}>
          <div class="name"><span>${r.name}</span><span class="mono muted">${r.id}</span></div>
          <div><div class="big num">${r.count.toLocaleString("en-GB")}</div><div class=${"what " + (v.tone ? v.tone + "-ink" : "muted")}>${v.text}</div></div>
          <${Sparkline} series=${r.series || []} />
          <div class="name muted"><span>Closes ${r.closes}</span></div>
        </div>`;
      })}</div>
      <${Fold} label=${"Not counted yet (" + uncounted.length + ")"} id="uncounted">
        <div class="group">${uncounted.map((r) => html`<${Row} key=${r.id} lead=${html`<${Lead}><span class="mono">${r.id}</span></${Lead}>`} title=${r.name} meta=${html`<span>Closes ${r.closes}</span>`} />`)}</div>
      </${Fold}>
    </${Section}>
    <${Section} title="Budgets" id="sec-budgets" ...${gh}>${SNAP.derived.measures.budgets.map((b) => html`<${BudgetCard} b=${b} key=${b.name} />`)}</${Section}>
    <${Section} title="Evals" id="sec-evals">
      <div class="group">${SNAP.derived.measures.evals.map((e) => html`<${Row} key=${e.step} lead=${html`<${Lead}><${Icon} n="info" /></${Lead}>`}
        title=${e.name} meta=${html`<span class="chip">Not measured yet</span><span>Step ${e.step}</span>`} />`)}</div>
    </${Section}>
  </${Page}>`;
}

function BudgetCard({ b }) {
  const p = p95(b.measured), review = b.budget * 1.5, max = Math.max(p, review) * 1.1;
  const over = p > review;
  const at = (n) => (n / max) * 100 + "%";
  return html`<div class="card">
    <div class="section-head"><span class="what"><b>${b.name}</b></span><span class=${"chip " + (over ? "bad" : "good")}><span class="dot"></span>${over ? "Review due" : "Within"}</span></div>
    <p class="verdict">p95 is ${p} ${b.unit}, ${Math.round((p / b.budget) * 10) / 10}× the ${b.budget}-${b.unit === "min" ? "minute" : b.unit} budget.</p>
    <p class="verdict-sub">${over ? "Past 1.5 times its budget, so an architecture review is raised. A budget never fails a run." : "Within 1.5 times its budget."} ${plural(b.measured.length, "run")} measured.</p>
    <div class=${"budget-bar" + (over ? " over" : "")} role="meter" aria-valuenow=${p} aria-valuemax=${max} aria-label=${b.name + " p95 against budget"}>
      <i style=${"width:" + at(p)}></i><span class="tick" style=${"left:" + at(b.budget)}></span><span class="tick review" style=${"left:" + at(review)}></span>
    </div>
    <div class="legend"><span><i class="tick-key"></i>Budget ${b.budget} ${b.unit}</span><span><i class="tick-key review"></i>Review at ${review} ${b.unit}</span><span><i class=${"bar-key" + (over ? " over" : "")}></i>p95 ${p} ${b.unit}</span></div>
  </div>`;
}
