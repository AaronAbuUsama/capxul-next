// Charts: the burn-down (units left over time, with the line at the current pace to zero, and a crosshair tooltip),
// the ratchet sparkline, and the budget bar. One series each, drawn to one scale, text in the theme's ink.

/* Units left at each change, for any set of steps: planned adds its units, proven or dropped takes them away. */
function burnOf(steps) {
  const evs = [];
  steps.forEach((s) => s.history.forEach((e) => {
    const u = s.fields.units || 1;
    if (e.event === "step_planned") evs.push({ at: e.at, d: u, done: 0, what: "step " + s.id + " planned" });
    if (e.event === "step_proven") evs.push({ at: e.at, d: -u, done: u, what: "step " + s.id + " proven" });
    if (e.event === "step_dropped") evs.push({ at: e.at, d: -u, done: 0, what: "step " + s.id + " dropped" });
    if (e.event === "step_reopened") evs.push({ at: e.at, d: u, done: -u, what: "step " + s.id + " reopened" });
  }));
  evs.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let left = 0, done = 0;
  return evs.map((e) => ({ at: e.at, left: (left += e.d), done: (done += e.done), what: e.what }));
}

/* The verdict: what is left, and how long the rest takes at the pace since the first unit was proven. */
function burnVerdict(series) {
  if (!series.length) return { text: "Nothing planned yet.", sub: "", rate: 0 };
  const last = series[series.length - 1];
  const firstDone = series.find((p) => p.done > 0);
  if (last.left === 0) return { text: "Everything planned is done.", sub: plural(last.done, "unit") + " proven.", rate: 0 };
  if (!firstDone) return { text: plural(last.left, "unit") + " left, none proven yet.", sub: "A pace shows once the first step is proven.", rate: 0 };
  const days = Math.max((nowMs() - Date.parse(firstDone.at)) / 864e5, 0.25);
  const rate = last.done / days;
  const need = last.left / rate;
  const span = need < 1 ? Math.max(1, Math.round(need * 24)) + " hours" : (Math.round(need * 10) / 10) + " days";
  return {
    text: plural(last.left, "unit") + " left. At this pace, about " + span + " more.",
    sub: plural(last.done, "unit") + " proven in " + (Math.round(days * 10) / 10) + " days, about " + Math.round(rate) + " a day.",
    rate,
  };
}

function BurnChart({ series, label }) {
  const [hover, setHover] = useState(null);
  if (series.length < 2) return html`<p class="muted">Not enough history to draw yet.</p>`;
  const W = 340, H = 150, L = 28, R = 8, Tp = 8, B = 22;
  const v = burnVerdict(series);
  const t0 = Date.parse(series[0].at), tNow = nowMs();
  const last = series[series.length - 1];
  const tEnd = v.rate > 0 ? Math.max(tNow, tNow + (last.left / v.rate) * 864e5) : tNow;
  const maxY = Math.max(...series.map((p) => p.left), 1);
  const x = (t) => L + ((t - t0) / Math.max(tEnd - t0, 1)) * (W - L - R);
  const y = (n) => Tp + (1 - n / maxY) * (H - Tp - B);
  let d = "", prev = null;
  series.forEach((p) => {
    const px = x(Date.parse(p.at)), py = y(p.left);
    d += prev == null ? `M${px},${py}` : `H${px}V${py}`;
    prev = py;
  });
  d += `H${x(tNow)}`;
  const area = d + `V${y(0)}H${x(t0)}Z`;
  const ticks = [0, Math.round(maxY / 2), maxY];
  const day = (t) => new Date(t).toLocaleDateString("en-GB", { ...UTC, day: "numeric", month: "short" });
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (tEnd - t0);
    let p = null;
    for (const q of series) if (Date.parse(q.at) <= t) p = q;
    setHover(p && t <= tNow ? { p, px: x(Date.parse(p.at)) / W, py: y(p.left) / H } : null);
  };
  return html`<div class="chart" role="img" aria-label=${label + ": " + v.text}>
    <svg viewBox=${`0 0 ${W} ${H}`} onPointerMove=${onMove} onPointerLeave=${() => setHover(null)}>
      ${ticks.map((n) => html`<g><line x1=${L} x2=${W - R} y1=${y(n)} y2=${y(n)} stroke="var(--grid)" stroke-width="1" /><text x=${L - 6} y=${y(n) + 4} text-anchor="end">${n}</text></g>`)}
      <path d=${area} fill="var(--chart-1)" fill-opacity="0.1" />
      <path d=${d} fill="none" stroke="var(--chart-1)" stroke-width="2" stroke-linejoin="round" />
      ${v.rate > 0 ? html`<line x1=${x(tNow)} y1=${y(last.left)} x2=${x(tEnd)} y2=${y(0)} stroke="var(--chart-ref)" stroke-width="2" stroke-dasharray="4 4" />` : null}
      <circle cx=${x(tNow)} cy=${y(last.left)} r="4" fill="var(--chart-1)" stroke="var(--surface)" stroke-width="2" />
      <text x=${L} y=${H - 4}>${day(t0)}</text>
      <text x=${x(tNow)} y=${H - 4} text-anchor=${tEnd > tNow + 3600e3 ? "middle" : "end"}>Now</text>
      ${tEnd > tNow + 3600e3 ? html`<text x=${W - R} y=${H - 4} text-anchor="end">${day(tEnd)}</text>` : null}
      ${hover ? html`<line x1=${hover.px * W} x2=${hover.px * W} y1=${Tp} y2=${y(0)} stroke="var(--ink-3)" stroke-width="1" />` : null}
    </svg>
    ${hover ? html`<div class="tip" style=${`left:${hover.px * 100}%;top:${hover.py * 100}%`}><b class="num">${hover.p.left} left</b> · ${hover.p.what}<br /><span class="muted">${when(hover.p.at)}</span></div>` : null}
  </div>`;
}

function BurnCard({ steps, series, label }) {
  const s = series || burnOf(steps);
  const v = burnVerdict(s);
  return html`<div class="card">
    <div><p class="verdict">${v.text}</p>${v.sub ? html`<p class="verdict-sub">${v.sub}</p>` : null}</div>
    <${BurnChart} series=${s} label=${label} />
    <div class="legend"><span><i></i>Units left</span>${v.rate > 0 ? html`<span><i class="ref"></i>At this pace</span>` : null}</div>
  </div>`;
}

function Sparkline({ series }) {
  const W = 120, H = 40, P = 4;
  const pts = series.map((p) => p.count);
  if (pts.length < 2) {
    return html`<svg viewBox=${`0 0 ${W} ${H}`} aria-hidden="true"><line x1=${P} x2=${W - P} y1=${H / 2} y2=${H / 2} stroke="var(--chart-1)" stroke-width="2" /><circle cx=${W - P} cy=${H / 2} r="3" fill="var(--chart-1)" /></svg>`;
  }
  const t = series.map((p) => Date.parse(p.at));
  const min = Math.min(...pts), max = Math.max(...pts), span = Math.max(max - min, 1);
  const x = (i) => P + ((t[i] - t[0]) / Math.max(t[t.length - 1] - t[0], 1)) * (W - 2 * P);
  const y = (n) => P + (1 - (n - min) / span) * (H - 2 * P);
  const d = pts.map((n, i) => (i ? "L" : "M") + x(i) + "," + y(n)).join("");
  return html`<svg viewBox=${`0 0 ${W} ${H}`} aria-hidden="true">
    <line x1=${P} x2=${W - P} y1=${y(max)} y2=${y(max)} stroke="var(--chart-ref)" stroke-width="1" stroke-dasharray="3 3" />
    <path d=${d + `L${x(pts.length - 1)},${H}L${x(0)},${H}Z`} fill="var(--chart-1)" fill-opacity="0.1" />
    <path d=${d} fill="none" stroke="var(--chart-1)" stroke-width="2" stroke-linejoin="round" />
    <circle cx=${x(pts.length - 1)} cy=${y(pts[pts.length - 1])} r="3" fill="var(--chart-1)" />
  </svg>`;
}

/* The p95 of a list of measures. */
function p95(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
