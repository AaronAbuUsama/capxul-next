// Sitreps: a feed by day, unheard bold with a dot, partly heard with a bar, heard dimmed. Tap one to fold it open:
// its parts (tap a part to play from it), play, mark heard, links, history. The player reads through the artifact's
// tts capability: one line per part, so back, forward and the parts bar start a new reading from another part.

let TTS; // undefined while asking, null where reading aloud is not available
const P = { sid: null, cur: -1, state: "idle", n: 0 };
function setP(patch) { Object.assign(P, patch); store.set({ player: { ...P } }); }

function initTts() {
  const use = window.claude && window.claude.use;
  if (!use) { TTS = null; store.set({ tts: "no" }); return; }
  Promise.resolve(use("tts")).then((t) => {
    TTS = t || null;
    store.set({ tts: TTS ? "yes" : "no" });
    if (!TTS) return;
    TTS.onState(({ state, reason }) => {
      if (state === "idle") {
        const s = IX.sitreps[P.sid];
        if (reason === "completed" && s) markHeard(s);
        if (reason !== "replaced") setP({ state: "idle" });
      } else setP({ state });
    });
    TTS.onLine(({ id }) => {
      const i = Number(id);
      if (Number.isNaN(i)) return;
      setP({ cur: i });
      store.set((s) => ({ heardParts: { ...s.heardParts, [P.sid]: Math.max(s.heardParts[P.sid] || 0, i) } }));
    });
  }, () => { TTS = null; store.set({ tts: "no" }); });
}

function speakFrom(sitrep, i) {
  if (!TTS) return;
  const parts = sitrep.fields.parts;
  if (i < 0 || i >= parts.length) return;
  setP({ sid: sitrep.id, cur: i, state: "starting", n: parts.length });
  const lines = parts.slice(i).map((text, k) => ({ id: String(i + k), text: (i + k === 0 ? sitrep.fields.title + ". " : "") + text }));
  TTS.speak(lines, { rate: store.s.rate }).catch((err) => {
    if (err && err.code === "stopped") return;
    if (err && (err.code === "not_granted" || err.code === "unavailable")) { TTS = null; store.set({ tts: "no" }); }
    if (err && err.code === "rate_limited") toast("Reading aloud is busy. Try again in a minute.");
    setP({ state: "idle" });
  });
}
const player = {
  toggle() { if (!TTS) return; if (P.state === "paused") TTS.resume(); else if (P.state !== "idle") TTS.pause(); },
  back() { const s = IX.sitreps[P.sid]; if (s) speakFrom(s, Math.max(0, P.cur - 1)); },
  forward() { const s = IX.sitreps[P.sid]; if (!s) return; if (P.cur + 1 < s.fields.parts.length) speakFrom(s, P.cur + 1); else player.stop(); },
  jump(i) { const s = IX.sitreps[P.sid]; if (s) speakFrom(s, i); },
  stop() { if (TTS) TTS.stop(); setP({ state: "idle" }); },
  rate(r) { store.set({ rate: r }); if (TTS && TTS.setRate) TTS.setRate(r); },
};
const SPEEDS = [0.75, 1, 1.25, 1.5];

function MiniPlayer() {
  const st = useStore();
  const [speeds, setSpeeds] = useState(false);
  const s = IX.sitreps[P.sid];
  if (!s || P.state === "idle") return null;
  const n = s.fields.parts.length;
  return html`<div class="player" role="region" aria-label="Player">
    <div class="top">
      <span class="np"><b>${s.fields.title}</b><span>Part ${P.cur + 1} of ${n}${P.state === "paused" ? " · Paused" : ""}</span></span>
      <span class="ctl">
        <button class="icon-btn" onClick=${player.back} aria-label="Back one part"><${Icon} n="back" /></button>
        <button class="play" onClick=${player.toggle} aria-label=${P.state === "paused" ? "Resume" : "Pause"}><${Icon} n=${P.state === "paused" ? "play" : "pause"} /></button>
        <button class="icon-btn" onClick=${player.forward} aria-label="Forward one part"><${Icon} n="fwd" /></button>
        <button class="speed num" onClick=${() => setSpeeds(!speeds)} aria-expanded=${speeds} aria-label=${"Speed " + st.rate + "×"}>${st.rate}×</button>
        <button class="icon-btn" onClick=${player.stop} aria-label="Stop"><${Icon} n="x" /></button>
      </span>
    </div>
    ${speeds ? html`<div class="speeds" role="group" aria-label="Speed">${SPEEDS.map((r) => html`<button class="num" aria-pressed=${st.rate === r} onClick=${() => { player.rate(r); setSpeeds(false); }}>${r}×</button>`)}</div>` : null}
    <div class="parts" role="group" aria-label="Parts">${s.fields.parts.map((_, i) => html`<button class=${i < P.cur ? "done" : i === P.cur ? "current" : ""} onClick=${() => player.jump(i)} aria-label=${"Play part " + (i + 1)} aria-current=${i === P.cur ? "true" : undefined}><i></i></button>`)}</div>
  </div>`;
}

function SitrepItem({ s, open }) {
  const st = store.s;
  const heard = stateOf("sitrep", s) === "heard";
  const n = s.fields.parts.length, got = st.heardParts[s.id] || 0;
  const partly = !heard && got > 0;
  const playingThis = P.sid === s.id && P.state !== "idle";
  const toggle = () => store.set({ openSitrep: open ? null : s.id });
  return html`<div class=${"sitrep-item" + (heard ? " heard" : "")} data-sitrep=${s.id}>
    <button class=${"row sitrep-row" + (heard ? " heard dim" : "")} aria-expanded=${open} onClick=${toggle}>
      ${heard ? html`<${Lead}><${Icon} n="check" sm /></${Lead}>` : html`<span class="dot-slot">${partly ? null : html`<span class="dot-unheard"></span>`}</span>`}
      <span class="body"><span class="title">${s.fields.title}</span>
        <span class="meta"><span>${clock(s.since)}</span><span>${plural(n, "part")}</span>${heard ? html`<span>Heard</span>` : partly ? html`<span class="bar progress" aria-label=${"Heard " + got + " of " + n}><i style=${"width:" + Math.round((got / n) * 100) + "%"}></i></span>` : html`<span class="sr">Not heard</span>`}</span></span>
      <span class="chev"><${Icon} n=${open ? "x" : "right"} sm /></span>
    </button>
    ${open ? html`<div class="sitrep-open">
      <div>${s.fields.parts.map((t, i) => html`<button class=${"part-btn" + (playingThis && P.cur === i ? " playing" : "")} disabled=${st.tts !== "yes"} onClick=${() => speakFrom(s, i)} aria-label=${"Play from part " + (i + 1)}><span class="n">${i + 1}</span><span>${t}</span></button>`)}</div>
      <div class="btn-row">
        ${st.tts === "yes" ? html`<button class="btn primary" onClick=${() => (playingThis ? player.toggle() : speakFrom(s, 0))}><${Icon} n=${playingThis && P.state !== "paused" ? "pause" : "play"} sm />${playingThis ? (P.state === "paused" ? "Resume" : "Pause") : "Play"}</button>` : null}
        <button class="btn" disabled=${heard} onClick=${() => markHeard(s)}><${Icon} n="check" sm />${heard ? "Heard" : "Mark heard"}</button>
      </div>
      ${(s.fields.links || []).length ? html`<div class="group">${s.fields.links.map((l) => html`<${Row} href=${l.href} key=${l.href} title=${l.label} />`)}</div>` : null}
      <${History} entries=${historyOf("sitrep", s)} id=${"r" + s.id} />
    </div>` : null}
  </div>`;
}

function SitrepsScreen() {
  const st = useStore();
  const reps = [...SNAP.sitreps].sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  const days = [];
  reps.forEach((s) => { const d = dayLabel(s.since); const g = days.find((x) => x.d === d); g ? g.list.push(s) : days.push({ d, list: [s] }); });
  const unheard = reps.filter((s) => stateOf("sitrep", s) !== "heard").length;
  return html`<${Page} title="Sitreps" pageKey="sitreps" sub=${unheard ? unheard + " not heard" : "All heard"}>
    ${st.tts === "no" ? html`<div class="note" role="status"><${Icon} n="speaker" sm /><span>Reading aloud is not available here. Every sitrep stays readable below.</span></div>` : null}
    ${days.map((g) => html`<${Section} key=${g.d} id=${"day-" + g.d}>
      <div class="day-head">${g.d}<span class="count">${g.list.length}</span></div>
      <div class="group">${g.list.map((s) => html`<${SitrepItem} s=${s} open=${st.openSitrep === s.id} key=${s.id} />`)}</div>
    </${Section}>`)}
  </${Page}>`;
}
