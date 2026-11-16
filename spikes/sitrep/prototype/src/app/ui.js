// Shared pieces: a page with a large title that shrinks into the bar on scroll, sections, inset grouped rows, folds,
// and the history every plan, milestone, step, lane, ask and sitrep ends with.

/* A page. `back` is the label of the page underneath; a root page has none. */
function Page({ title, sub, back, end, children, cls, pageKey }) {
  const [scrolled, setScrolled] = useState(false);
  const [lifted, setLifted] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; setScrolled(false); setLifted(false); }, [pageKey]);
  const onScroll = (e) => {
    const top = e.currentTarget.scrollTop;
    if (top > 36 !== scrolled) setScrolled(top > 36);
    if (top > 2 !== lifted) setLifted(top > 2);
  };
  return html`<section ref=${ref} class=${"page " + (cls || "") + (scrolled ? " scrolled" : "") + (lifted ? " lifted" : "")} onScroll=${onScroll} aria-label=${title}>
    <header class="navbar">
      <div>${back ? html`<button class="back" onClick=${() => nav.pop()} aria-label=${"Back to " + back}><${Icon} n="left" /><span>${back}</span></button>` : null}</div>
      <div class="small-title" aria-hidden="true">${title}</div>
      <div class="end">${end}</div>
    </header>
    <div class="content">
      <div class="large">
        <h1>${title}</h1>
        ${sub ? html`<div class="sub">${sub}</div>` : null}
      </div>
      ${children}
    </div>
  </section>`;
}

const Section = ({ title, count, foot, stale, children, id }) => html`<section class="section" aria-labelledby=${id}>
  ${title ? html`<div class="section-head"><h2 id=${id}>${title}${count != null ? html`<span class="count">${count}</span>` : null}</h2></div>` : null}
  ${children}
  ${foot ? html`<div class=${"section-foot" + (stale ? " stale" : "")}>${stale ? html`<${Icon} n="clock" sm />` : null}${foot}</div>` : null}
</section>`;

/* One row of an inset grouped list. A row with `onClick` is a button; with `href`, a link out. */
function Row({ lead, title, meta, end, onClick, href, dim, cls, label }) {
  const inner = html`${lead}
    <span class="body"><span class="title">${title}</span>${meta ? html`<span class="meta">${meta}</span>` : null}</span>
    ${end != null ? html`<span class="end">${end}</span>` : null}
    ${onClick ? html`<span class="chev"><${Icon} n="right" sm /></span>` : href ? html`<span class="chev"><${Icon} n="link" sm /></span>` : null}`;
  const c = "row" + (dim ? " dim" : "") + (cls ? " " + cls : "");
  if (onClick) return html`<button class=${c} onClick=${onClick} aria-label=${label}>${inner}</button>`;
  if (href) return html`<a class=${c} href=${href} target="_blank" rel="noopener" aria-label=${label}>${inner}</a>`;
  return html`<div class=${c}>${inner}</div>`;
}
const Lead = ({ tone, children }) => html`<span class=${"lead-icon " + (tone || "")} aria-hidden="true">${children}</span>`;

/* A fold: a head that opens and closes a body. Escape closes the fold that has focus inside it. */
function Fold({ label, children, open: initial, id }) {
  const [open, setOpen] = useState(!!initial);
  const bodyId = "fold-" + id;
  const onKey = (e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); e.currentTarget.querySelector(".fold-head").focus(); } };
  return html`<div class="fold" onKeyDown=${onKey}>
    <button class="fold-head" aria-expanded=${open} aria-controls=${bodyId} onClick=${() => setOpen(!open)}>
      <span class="chev"><${Icon} n="right" sm /></span>${label}
    </button>
    <div id=${bodyId} class=${"fold-body" + (open ? " open" : "")} inert=${open ? undefined : true}><div>${children}</div></div>
  </div>`;
}

/* A thing's history: each event, who made it and when. */
function History({ entries, id }) {
  const list = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return html`<${Section} title="History" count=${list.length} id=${"history-" + id}>
    <div class="group history">
      ${list.map((e) => {
        const w = who(e.by);
        const quote = e.answer ? (e.answer.chose ? "Chose " + e.answer.chose + (e.answer.note ? ": " + e.answer.note : "") : "“" + e.answer.own + "”") : null;
        return html`<div class="h-item">
          <span class=${"h-icon " + w.kind} aria-hidden="true">${w.emoji}</span>
          <div class="h-body">
            <span class="what">${EVENT_WORDS[e.event] || e.event}</span>
            ${quote ? html`<span class="quote">${quote}</span>` : null}
            <span class="ink2">${w.name}</span>
            <span class="muted">${w.kind === "agent" ? cap(w.type) + " thread" : w.kind === "pipeline" ? "Pipeline" : "Person"} · <time datetime=${e.at}>${when(e.at)}</time></span>
          </div>
        </div>`;
      })}
    </div>
  </${Section}>`;
}

/* Labelled paragraphs, for a plan's or a step's written parts. */
const Prose = ({ parts }) => html`<div class="card prose">
  ${parts.filter((p) => p[1]).map(([label, text]) => html`<div class="part"><span class="eyebrow">${label}</span>${Array.isArray(text) ? text : html`<p>${text}</p>`}</div>`)}
</div>`;

/* Where a section's facts came from, with their age; amber and in words once older than 30 minutes. */
function SourceFoot({ source }) {
  const src = (SNAP.derived.sources || []).find((s) => s.id === source);
  if (!src) return null;
  const stale = isStale(src.read);
  return { foot: (stale ? "Stale: " : "") + src.name + ", read " + ago(src.read), stale };
}
