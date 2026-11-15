// The page's state: which tab, what is pushed on each tab, and the events Aaron adds on this page (ask_answered,
// sitrep_heard), each stamped with his name and the time. A thing's state on the page is the snapshot's state with
// his events played on top, the same way the projection replays the log.
const TABS = [
  { id: "now", label: "Now", icon: "now" },
  { id: "plan", label: "Plan", icon: "plan" },
  { id: "lanes", label: "Lanes", icon: "lanes" },
  { id: "measures", label: "Measures", icon: "measures" },
  { id: "sitreps", label: "Sitreps", icon: "sitreps" },
];
const AARON = { kind: "person", person: "aaron" };

const store = {
  s: {
    tab: "now",
    stacks: { now: [], plan: [], lanes: [], measures: [], sitreps: [] },
    added: [], // { thing, id, event, by, at, state, answer? }
    toast: null, // { text, undo }
    heardParts: {}, // sitrep id -> parts heard
    rate: 1,
  },
  subs: new Set(),
  set(patch) {
    this.s = { ...this.s, ...(typeof patch === "function" ? patch(this.s) : patch) };
    this.subs.forEach((f) => f(this.s));
  },
};
function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    store.subs.add(f);
    return () => store.subs.delete(f);
  }, []);
  return store.s;
}

/* Navigation: a stack of pushed pages per tab. */
const nav = {
  tab(id) { store.set((s) => ({ tab: id, stacks: s.tab === id ? { ...s.stacks, [id]: [] } : s.stacks })); },
  push(page) { store.set((s) => ({ stacks: { ...s.stacks, [s.tab]: [...s.stacks[s.tab], page] } })); },
  pop() { store.set((s) => ({ stacks: { ...s.stacks, [s.tab]: s.stacks[s.tab].slice(0, -1) } })); },
  top() { const st = store.s.stacks[store.s.tab]; return st[st.length - 1]; },
};

/* Aaron's events. */
const added = (thing, id) => store.s.added.filter((e) => e.thing === thing && e.id === id);
const historyOf = (thing, item) => [...item.history, ...added(thing, item.id)];
function stateOf(thing, item) {
  const mine = added(thing, item.id);
  return mine.length ? mine[mine.length - 1].state : item.state;
}
let toastTimer = null;
function toast(text, undo) {
  clearTimeout(toastTimer);
  store.set({ toast: { text, undo } });
  toastTimer = setTimeout(() => store.set({ toast: null }), 6000);
}
function addEvent(e) {
  const ev = { by: AARON, at: nowIso(), ...e };
  store.set((s) => ({ added: [...s.added, ev] }));
  return ev;
}
function removeEvent(ev) { store.set((s) => ({ added: s.added.filter((x) => x !== ev) })); }

function answerAsk(ask, answer) {
  const ev = addEvent({ thing: "ask", id: ask.id, event: "ask_answered", state: "answered", answer });
  const what = answer.chose ? "Answered " + answer.chose : "Answered in your own words";
  toast(what, () => { removeEvent(ev); store.set({ toast: null }); });
}
function markHeard(sitrep) {
  if (stateOf("sitrep", sitrep) === "heard") return;
  addEvent({ thing: "sitrep", id: sitrep.id, event: "sitrep_heard", state: "heard" });
  store.set((s) => ({ heardParts: { ...s.heardParts, [sitrep.id]: sitrep.fields.parts.length } }));
}
const openAsks = () => SNAP.needsYou.asks.map((id) => IX.asks[id]).filter((a) => a && stateOf("ask", a) === "open");
