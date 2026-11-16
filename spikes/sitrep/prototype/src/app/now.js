// Now: only what needs Aaron. Each ask is a card he answers in place (an option, or his own words), with an undo
// toast; then the threads waiting on him, the health of master and the last full run, and the sitreps not yet heard.

function AskCard({ ask, standalone }) {
  const f = ask.fields;
  const state = stateOf("ask", ask);
  const [own, setOwn] = useState(false);
  const [text, setText] = useState("");
  const t = threadLabel(f.from);
  const done = state === "answered";
  const ans = done ? [...historyOf("ask", ask)].reverse().find((e) => e.event === "ask_answered") : null;
  const a = ans && ans.answer;
  const example = /^ask-example-/.test(ask.id);
  const send = () => { if (text.trim().length >= 3) { answerAsk(ask, { own: text.trim() }); setOwn(false); setText(""); } };
  return html`<article class=${"ask" + (done ? " resolved" : "")} aria-label=${(done ? "Answered: " : "") + f.question} data-ask=${ask.id}>
    <div class="ask-who">
      <span class="avatar" aria-hidden="true">${t.emoji}</span>
      <span class="who"><b>${t.name}</b><span class="muted">${done ? "Answered by you, " + clock(ans.at) : "Waiting " + ago(ask.since).replace(" ago", "")}</span></span>
      ${example ? html`<span class="chip">Example</span>` : null}
    </div>
    <h3>${f.question}</h3>
    <div class=${"options" + (done ? " decided" : "")} role="group" aria-label="Options">
      ${f.options.map((o) => {
        const chosen = a && a.chose === o.key;
        return html`<button class=${"option" + (o.key === f.recommended ? " recommended" : "") + (chosen ? " chosen" : "")} disabled=${done} onClick=${() => answerAsk(ask, { chose: o.key })}
          aria-label=${(chosen ? "Chosen: " : "Choose ") + o.key + ": " + o.title + (o.key === f.recommended ? ", recommended" : "")}>
          <span class="letter" aria-hidden="true">${chosen ? html`<${Icon} n="check" sm />` : o.key}</span>
          <span class="o-body">
            <span class="o-title"><span>${o.title}</span>${o.key === f.recommended ? html`<span class="chip accent">Recommended</span>` : null}</span>
            <span class="o-detail">${o.detail}</span>
          </span>
        </button>`;
      })}
      ${done && a && a.own ? html`<div class="option chosen own-answer"><span class="letter" aria-hidden="true"><${Icon} n="check" sm /></span>
        <span class="o-body"><span class="o-title">In your own words</span><span class="o-detail">${a.own}</span></span></div>` : null}
      ${done ? null : html`<button class="option own-option" aria-expanded=${own} onClick=${() => setOwn(!own)}>
        <span class="letter" aria-hidden="true"><${Icon} n="pen" sm /></span>
        <span class="o-body"><span class="o-title">Answer in my own words</span></span>
      </button>`}
      ${own && !done ? html`<div class="own">
        <label class="sr" for=${"own-" + ask.id}>Your answer</label>
        <textarea id=${"own-" + ask.id} value=${text} onInput=${(e) => setText(e.currentTarget.value)} placeholder="Say what you want done, and why." onKeyDown=${(e) => { if (e.key === "Escape") { e.stopPropagation(); setOwn(false); } }} />
        <div class="btn-row"><button class="btn primary" disabled=${text.trim().length < 3} onClick=${send}>Send answer</button><button class="btn" onClick=${() => setOwn(false)}>Cancel</button></div>
      </div>` : null}
    </div>
    <div class="ask-foot">
      <${Fold} label="Details" id=${"details-" + ask.id}>
        <div class="details">
          <div><h4 class="eyebrow">Problem</h4><p>${f.problem}</p></div>
          <div><h4 class="eyebrow">Context</h4><p>${f.context}</p></div>
          <div><h4 class="eyebrow">Rubric</h4><ul>${f.rubric.map((r) => html`<li><b>${r.name}.</b> <span class="ink2">${r.why}</span></li>`)}</ul></div>
          <div><h4 class="eyebrow">Trade-offs</h4><ul>${f.options.map((o) => html`<li><b>${o.key}.</b> <span class="ink2">${o.tradeoffs}</span></li>`)}</ul></div>
          <div><h4 class="eyebrow">Why this recommendation</h4><p>${f.because}</p></div>
        </div>
      </${Fold}>
      ${standalone ? null : html`<button class="btn ghost" onClick=${() => nav.push({ kind: "ask", id: ask.id })}>History<${Icon} n="right" sm /></button>`}
    </div>
  </article>`;
}

function AskPage({ id, back }) {
  const ask = IX.asks[id];
  return html`<${Page} title="Ask" back=${back} pageKey=${id} sub=${html`<${Chip} s=${stateOf("ask", ask)} />${ask.fields.lane ? html`<span>Lane ${ask.fields.lane}</span>` : null}`}>
    <${AskCard} ask=${ask} standalone=${true} />
    <${History} entries=${historyOf("ask", ask)} id=${id} />
  </${Page}>`;
}

function NowScreen() {
  useStore();
  const asks = SNAP.needsYou.asks.map((id) => IX.asks[id]).filter(Boolean);
  const open = openAsks();
  const waiting = SNAP.needsYou.threads.map((id) => IX.threads[id]).filter(Boolean);
  const h = SNAP.derived.health;
  const run = h.runs[h.runs.length - 1];
  const budget = (SNAP.derived.measures.budgets || [])[0];
  const unheard = SNAP.sitreps.filter((s) => stateOf("sitrep", s) !== "heard").sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  const gh = SourceFoot({ source: "github" });
  const cond = SourceFoot({ source: "conductor" });
  return html`<${Page} title="Now" pageKey="now" sub=${open.length ? plural(open.length, "decision") + " waiting on you" : "Nothing waiting on you"}>
    <${Section} title="Asks" count=${open.length || null} id="sec-asks">
      ${asks.map((a) => html`<${AskCard} ask=${a} key=${a.id} />`)}
      ${open.length === 0 ? html`<div class="card empty" role="status">
        <span class="badge"><${Icon} n="check" /></span>
        <h3>Nothing needs you</h3>
        <p>Every ask is answered. The lanes carry on; the next sitrep says what moved.</p>
      </div>` : null}
    </${Section}>
    ${waiting.length ? html`<${Section} title="Threads waiting on you" count=${waiting.length} id="sec-waiting" ...${cond}>
      <div class="group">
        ${waiting.map((t) => html`<div class="row" key=${t.id}>
          <${Lead}>${THREAD_TYPES[t.fields.type] || "🤖"}</${Lead}>
          <span class="body"><span class="title">${t.fields.title}</span><span class="meta"><${Chip} s="waiting" /><span>${ago(t.since)}</span></span></span>
          <a class="btn" href=${t.fields.link} target="_blank" rel="noopener">Open</a>
        </div>`)}
      </div>
    </${Section}>` : null}
    <${Section} title="Health" id="sec-health" ...${gh}>
      <div class="group">
        <${Row} href=${h.master.href} lead=${html`<${Lead} tone=${h.master.state === "green" ? "good" : "bad"}><${Icon} n=${h.master.state === "green" ? "check" : "warn"} /></${Lead}>`}
          title="master" meta=${html`<${Chip} s=${h.master.state} /><span class="mono">${h.master.label}</span><span>${ago(h.master.at)}</span>`} />
        ${run ? html`<${Row} href=${run.href} lead=${html`<${Lead} tone=${run.outcome === "passed" ? "good" : "bad"}><${Icon} n="clock" /></${Lead}>`}
          title="Last full run" meta=${html`<${Chip} s=${run.outcome} /><span>${run.slice}</span><span>${ago(run.at)}</span>`}
          end=${html`<span class=${"num" + (budget && run.minutes > budget.budget * 1.5 ? " bad-ink" : "")}>${run.minutes} min</span>`} />` : null}
      </div>
    </${Section}>
    <${Section} title="New sitreps" count=${unheard.length || null} id="sec-new">
      ${unheard.length ? html`<div class="group">
        ${unheard.slice(0, 3).map((s) => html`<${Row} key=${s.id} cls="sitrep-row" onClick=${() => { store.set({ openSitrep: s.id }); nav.tab("sitreps"); }}
          lead=${html`<span class="dot-unheard" aria-label="Not heard"></span>`} title=${s.fields.title} meta=${html`<span>${when(s.since)}</span><span>${plural(s.fields.parts.length, "part")}</span>`} />`)}
      </div>` : html`<p class="muted section-foot">You have heard every sitrep.</p>`}
    </${Section}>
  </${Page}>`;
}
