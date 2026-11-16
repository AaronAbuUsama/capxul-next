// The shell: five tabs on a phone (a sidebar on a laptop), pushed pages with a back chevron (a right panel on a
// laptop), the toast, the mini player, and the loading, error and empty states. #loading, #error and #empty show
// those states on purpose, for review.

const ROOTS = { now: NowScreen, plan: PlanScreen, lanes: LanesScreen, measures: MeasuresScreen, sitreps: SitrepsScreen };
const ROOT_TITLES = { now: "Now", plan: "Plan", lanes: "Lanes", measures: "Measures", sitreps: "Sitreps" };
const PAGES = { milestone: MilestonePage, step: StepPage, lane: LanePage, ask: AskPage };
function titleOf(e) {
  if (e.kind === "milestone") return IX.milestones[e.id].fields.title;
  if (e.kind === "step") return "Step " + e.id;
  if (e.kind === "lane") return IX.lanes[e.id].fields.title;
  return "Ask";
}

function useWide() {
  const q = window.matchMedia("(min-width: 960px)");
  const [wide, setWide] = useState(q.matches);
  useEffect(() => { const f = () => setWide(q.matches); q.addEventListener("change", f); return () => q.removeEventListener("change", f); }, []);
  return wide;
}

function Tabs({ cls, itemCls }) {
  const st = useStore();
  const badge = openAsks().length;
  return html`<nav class=${cls} aria-label="Sections">
    ${cls === "sidebar" ? html`<div class="brand"><span class="mark"><${Icon} n="plan" /></span><span><b>Sitrep</b><span>The Capxul rebuild</span></span></div>` : null}
    ${TABS.map((t) => html`<button class=${itemCls} key=${t.id} aria-current=${st.tab === t.id ? "page" : undefined} onClick=${() => nav.tab(t.id)} data-tab=${t.id}>
      <${Icon} n=${t.icon} /><span>${t.label}</span>
      ${t.id === "now" && badge ? html`<span class="badge num" aria-label=${badge + " waiting"}>${badge}</span>` : null}
    </button>`)}
    ${cls === "sidebar" ? html`<div class="side-foot">${SNAP.derived.sources.map((s) => html`<span class=${isStale(s.read) ? "warn-ink" : ""} key=${s.id}>${s.name}: ${ago(s.read)}</span>`)}</div>` : null}
  </nav>`;
}

function Toast() {
  const st = useStore();
  if (!st.toast) return null;
  const lift = P.state !== "idle";
  return html`<div class=${"toast" + (lift ? " lift" : "")} role="status" aria-live="polite">
    <span>${st.toast.text}</span>
    ${st.toast.undo ? html`<button onClick=${st.toast.undo}>Undo</button>` : null}
  </div>`;
}

function App() {
  const st = useStore();
  const wide = useWide();
  const stack = st.stacks[st.tab];
  const Root = ROOTS[st.tab];
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (store.s.openSitrep) store.set({ openSitrep: null });
      else if (store.s.stacks[store.s.tab].length) nav.pop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const pageAt = (e, i, cls) => {
    const C = PAGES[e.kind];
    const back = i === 0 ? ROOT_TITLES[st.tab] : titleOf(stack[i - 1]);
    return html`<div class=${"stack-page " + cls} key=${e.kind + e.id + i}><${C} id=${e.id} back=${back} /></div>`;
  };
  const top = stack.length - 1;
  return html`<div class="app" data-wide=${wide}>
    ${wide ? html`<${Tabs} cls="sidebar" itemCls="side-item" />` : null}
    <main class="main">
      <div class=${"stack-page" + (!wide && stack.length ? " under" : "")} key=${"root-" + st.tab}><${Root} /></div>
      ${!wide ? stack.map((e, i) => pageAt(e, i, i === top ? "pushed enter" : "under")) : null}
    </main>
    ${wide && stack.length ? html`<aside class="panel" aria-label="Detail">${pageAt(stack[top], top, "enter")}</aside>` : null}
    ${wide ? null : html`<${Tabs} cls="tabbar" itemCls="tab" />`}
    <${MiniPlayer} />
    <${Toast} />
  </div>`;
}

class Boundary extends preact.Component {
  constructor() { super(); this.state = { error: null }; }
  componentDidCatch(error) { this.setState({ error }); }
  render() { return this.state.error ? html`<${ErrorPage} error=${this.state.error} />` : this.props.children; }
}
const ErrorPage = ({ error }) => html`<div class="error-page" role="alert"><div class="card">
  <span class="lead-icon bad"><${Icon} n="warn" /></span>
  <h1>The sitrep could not be shown</h1>
  <p>The snapshot did not match the blueprint's shapes, so nothing is shown rather than something wrong. The next refresh rebuilds it; if this stays, the refresh's run says why.</p>
  <pre>${String(error && error.message ? error.message : error)}</pre>
</div></div>`;

(function start() {
  const root = document.getElementById("app");
  const demo = location.hash.slice(1);
  if (demo === "loading") return;
  if (!SNAP || demo === "error") {
    render(html`<${ErrorPage} error=${SNAP ? "Demo: snapshot refused (event 41 is no declared event)." : "No snapshot was embedded in the page."} />`, root);
    return;
  }
  if (demo === "empty") { SNAP.needsYou = { asks: [], threads: [] }; }
  root.textContent = "";
  initTts();
  render(html`<${Boundary}><${App} /></${Boundary}>`, root);
})();
