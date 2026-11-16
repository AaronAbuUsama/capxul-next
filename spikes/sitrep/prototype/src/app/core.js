// Core: Preact through htm, the icon set, the snapshot's indexes, time in words, and who made a change.
// The page reads only window.SNAPSHOT (embedded by build.mjs from snapshot.json) and window.MACHINES.
const { h, render } = preact;
const { useState, useEffect, useRef, useMemo, useCallback } = preactHooks;
const html = htm.bind(h);

/* One icon set: 24-unit paths, drawn with one stroke width (--icon-stroke). */
const PATHS = {
  now: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z",
  plan: "M4 22V4a1 1 0 0 1 1-1h12l-2 4 2 4H5",
  lanes: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9",
  measures: "M22 12h-4l-3 9L9 3l-3 9H2",
  sitreps: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
  right: "m9 18 6-6-6-6",
  left: "m15 18-6-6 6-6",
  play: "M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z",
  pause: "M8 5v14M16 5v14",
  back: "M11 19 4 12l7-7M20 19l-7-7 7-7",
  fwd: "m13 19 7-7-7-7M4 19l7-7-7-7",
  x: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  warn: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  pr: "M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 15V8a2 2 0 0 0-2-2h-5M13 3l-2 3 2 3",
  link: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  stop: "M6 6h12v12H6z",
  speaker: "M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01",
};
const Icon = ({ n, sm, label }) =>
  html`<svg class=${"i" + (sm ? " sm" : "")} viewBox="0 0 24 24" aria-hidden=${label ? undefined : "true"} role=${label ? "img" : undefined} aria-label=${label}><path d=${PATHS[n]} /></svg>`;

/* The snapshot and its indexes. */
const SNAP = window.SNAPSHOT;
const byId = (list) => Object.fromEntries((list || []).map((x) => [x.id, x]));
const IX = SNAP
  ? {
      milestones: byId(SNAP.milestones),
      steps: byId(SNAP.steps),
      lanes: byId(SNAP.lanes),
      threads: byId(SNAP.threads),
      asks: byId(SNAP.asks),
      sitreps: byId(SNAP.sitreps),
    }
  : {};
const laneOfStep = (stepId) => (SNAP.lanes || []).find((l) => (l.fields.steps || []).includes(stepId));

/* Time. "Now" is the snapshot's own time plus however long the page has been open, so ages are those the refresh saw. */
const T0 = performance.now();
const nowMs = () => Date.parse(SNAP.at) + (performance.now() - T0);
const nowIso = () => new Date(nowMs()).toISOString().replace(/\.\d+Z$/, "Z");
const UTC = { timeZone: "UTC" };
const clock = (at) => new Date(at).toLocaleTimeString("en-GB", { ...UTC, hour: "2-digit", minute: "2-digit" });
function ago(at, short) {
  const m = Math.max(0, Math.round((nowMs() - Date.parse(at)) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return short ? m + "m" : m + (m === 1 ? " minute" : " minutes") + " ago";
  const hrs = Math.round(m / 60);
  if (hrs < 24) return short ? hrs + "h" : hrs + (hrs === 1 ? " hour" : " hours") + " ago";
  const d = Math.round(hrs / 24);
  return short ? d + "d" : d + (d === 1 ? " day" : " days") + " ago";
}
function dayLabel(at) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const d = day(Date.parse(at)), today = day(nowMs()), yday = day(nowMs() - 864e5);
  if (d === today) return "Today";
  if (d === yday) return "Yesterday";
  return new Date(at).toLocaleDateString("en-GB", { ...UTC, weekday: "long", day: "numeric", month: "long" });
}
const when = (at) => (dayLabel(at) === "Today" ? clock(at) : dayLabel(at) + ", " + clock(at));
const STALE_MS = 30 * 60000;
const isStale = (at) => nowMs() - Date.parse(at) > STALE_MS;

/* Who made a change: an agent's thread (its type's emoji), a person, or the pipeline's run. */
const THREAD_TYPES = {
  conductor: "🎼", lead: "🧭", author: "✍️", builder: "🔨", reviewer: "🔍", designer: "📐", triage: "🧹", keeper: "🕒", local: "🖥️",
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function threadLabel(id) {
  const t = IX.threads[id];
  if (!t) return { emoji: "🤖", name: "Agent thread", type: "agent" };
  return { emoji: THREAD_TYPES[t.fields.type] || "🤖", name: t.fields.title, type: t.fields.type };
}
function who(by) {
  if (!by) return { kind: "agent", emoji: "?", name: "Unknown" };
  if (by.kind === "person") return { kind: "person", emoji: "A", name: cap(by.person) };
  if (by.kind === "pipeline") return { kind: "pipeline", emoji: "⚙︎", name: "CI run " + String(by.run).replace(/^ci-/, "") };
  const t = threadLabel(by.thread);
  return { kind: "agent", emoji: t.emoji, name: t.name, type: t.type };
}

/* Words for events and states. */
const EVENT_WORDS = {
  plan_written: "Plan written", plan_agreed: "Plan agreed", plan_revised: "Plan revised",
  milestone_planned: "Milestone planned", milestone_started: "Milestone started", milestone_revised: "Milestone revised",
  step_planned: "Step planned", step_started: "Step started", step_proven: "Step proven", step_reopened: "Step reopened", step_dropped: "Step dropped",
  lane_opened: "Lane opened", lane_led: "Lead started", lane_landed: "Lane landed",
  thread_started: "Thread started", thread_waiting: "Waiting on Aaron", thread_resumed: "Thread resumed", thread_archived: "Thread archived",
  ask_opened: "Asked", ask_answered: "Answered", ask_reopened: "Answer undone", ask_withdrawn: "Withdrawn",
  sitrep_said: "Sitrep said", sitrep_heard: "Heard",
};
const STATE_CHIP = {
  done: ["good", "Done"], active: ["accent", "Moving"], planned: ["", "Not started"], dropped: ["", "Dropped"],
  agreed: ["good", "Agreed"], draft: ["warn", "Draft"], open: ["accent", "Open"], landed: ["good", "Landed"],
  answered: ["good", "Answered"], withdrawn: ["", "Withdrawn"], waiting: ["warn", "Waiting on you"], archived: ["", "Archived"],
  green: ["good", "Green"], red: ["bad", "Red"], passed: ["good", "Passed"], failed: ["bad", "Failed"],
  draft_pr: ["", "Draft"], merged: ["good", "Merged"], closed: ["", "Closed"],
};
const Chip = ({ s, label }) => {
  const [tone, words] = STATE_CHIP[s] || ["", cap(s)];
  return html`<span class=${"chip " + tone}><span class="dot"></span>${label || words}</span>`;
};
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
