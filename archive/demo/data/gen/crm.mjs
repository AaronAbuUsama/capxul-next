// CRM: companies (Frappe CRM's Organizations), contacts, 118 leads, 38 deals, and each record's timeline of emails,
// WhatsApp messages, calls, notes, tasks, status changes and the money the chain proves.
import { rng, addDays, at, TODAY, NOW, START, minDate, maxDate, daysBetween, slug, hashOf } from "./util.mjs";
import { isWorking } from "./hr.mjs";

export const LEAD_STATUSES = [
  { name: "New", color: "gray", type: "Open" }, { name: "Contacted", color: "orange", type: "Ongoing" }, { name: "Nurture", color: "blue", type: "Ongoing" },
  { name: "Qualified", color: "green", type: "Won" }, { name: "Unqualified", color: "red", type: "Lost" }, { name: "Junk", color: "purple", type: "Lost" },
];
export const DEAL_STATUSES = [
  { name: "Qualification", color: "gray", type: "Open", probability: 10 }, { name: "Demo/Making", color: "orange", type: "Ongoing", probability: 25 },
  { name: "Proposal/Quotation", color: "blue", type: "Ongoing", probability: 50 }, { name: "Negotiation", color: "yellow", type: "Ongoing", probability: 70 },
  { name: "Ready to Close", color: "purple", type: "Ongoing", probability: 90 }, { name: "Won", color: "green", type: "Won", probability: 100 }, { name: "Lost", color: "red", type: "Lost", probability: 0 },
];
export const LOST_REASONS = ["Pricing", "Competition", "Budget Constraints", "Missing Features", "Long Sales Cycle", "No Decision-Maker", "Unresponsive Prospect", "Poor Fit", "Other"];
const SOURCES = [["Website", 38], ["Reference", 24], ["Existing Customer", 12], ["Exhibition", 10], ["Email", 9], ["Campaign", 7]];

const FIRST = ["Owen", "Dana", "Luis", "Aisha", "Priyanka", "Freja", "Martin", "Helen", "Marcus", "Tobias", "Amelia", "Jo", "Rachel", "Gareth", "Siobhan", "Callum", "Nadia", "Imran", "Beth", "Tom", "Ruairi", "Elena", "Kofi", "Hannah", "Joel", "Sana", "Victoria", "Ade", "Lucy", "Rory", "Mei", "Fiona", "Daniel", "Isabel", "Kieran", "Yusuf", "Charlotte", "Niamh", "Oscar", "Zainab", "Matt", "Georgia", "Hamza", "Ellie", "Will", "Anya", "Femi", "Jess", "Raj", "Sophie", "Ben", "Leah", "Alex", "Tara", "Chris", "Holly"];
const LAST = ["Tate", "Whitaker", "Ortega", "Rahman", "Shah", "Holm", "Cole", "Marsh", "Lee", "Wren", "Grant", "Bates", "Pearce", "Llewellyn", "Byrne", "Fraser", "Iqbal", "Kaur", "Morris", "Hughes", "Doyle", "Petrova", "Asante", "Moore", "Bennett", "Akhtar", "Hale", "Okonkwo", "Barnes", "Gallagher", "Chen", "Mackay", "Novak", "Silva", "Walsh", "Ali", "Davies", "Quinn", "Lindgren", "Yusuf", "Price", "Hart", "Malik", "Spencer", "Reid", "Volkova", "Adebayo", "Clarke", "Patel", "Turner", "Kerr", "Ward", "Foster", "Lowe", "Hayes", "Nolan"];
const TITLES = ["Head of Digital", "Product Director", "VP Product", "Operations Director", "Marketing Director", "Digital Services Manager", "Chief Executive", "Engineering Manager", "Head of Customer Experience", "Founder", "Managing Partner", "IT Manager", "Brand Manager", "Head of Product", "COO"];

const NEED = {
  Energy: ["a field engineers' app", "a customer self-service portal"], "Real Estate": ["a tenant portal", "a repairs reporting service"], Architecture: ["a new website with consultation booking"],
  Advertising: ["a new brand identity"], Retail: ["a replatform of our online shop", "a store finder and click and collect"], "Health Care": ["online appointment booking", "a patient portal", "a carer rota app"],
  Food: ["an ordering app for our shops", "an online shop", "a brand refresh"], Software: ["a design system", "a design review of our product"], "Non Profit": ["an accessibility audit of our websites"],
  Transportation: ["an audit of our driver app", "a discovery sprint on assistance booking"], Education: ["a design sprint on tutor matching", "a parent and pupil portal"], "Financial Services": ["a member app"],
  Hospitality: ["a booking engine for our hotels"], Government: ["a planning applications service"], Media: ["a new website for our label"], Manufacturing: ["a dealer portal"], Analytics: ["dashboards for our customers"],
};

// prospects who never became customers (lost or open deals, and leads that went nowhere)
const PROSPECTS = [
  { id: "kestrel-health", name: "Kestrel Health", industry: "Health Care", territory: "United Kingdom", city: "Manchester", website: "kestrelhealth.co.uk", employees: "201-500", revenue: 38000000, desc: "Digital health provider for NHS community clinics" },
  { id: "oakvale", name: "Oakvale Housing Association", industry: "Real Estate", territory: "United Kingdom", city: "Nottingham", website: "oakvalehousing.org.uk", employees: "201-500", revenue: 41000000, desc: "Housing association with 7,500 homes in the East Midlands" },
  { id: "brightwater", name: "Brightwater Schools Trust", industry: "Education", territory: "United Kingdom", city: "Norwich", website: "brightwaterschools.org.uk", employees: "501-1000", revenue: 52000000, desc: "Multi-academy trust of nine schools in Norfolk" },
  { id: "quayside", name: "Quayside Credit Union", industry: "Financial Services", territory: "United Kingdom", city: "Liverpool", website: "quaysidecu.co.uk", employees: "11-50", revenue: 3100000, desc: "Credit union for 14,000 members on Merseyside" },
  { id: "bluefern", name: "Blue Fern Hotels", industry: "Hospitality", territory: "United Kingdom", city: "Bath", website: "bluefernhotels.co.uk", employees: "201-500", revenue: 27000000, desc: "Eleven boutique hotels in the South West" },
  { id: "elmstead", name: "Elmstead District Council", industry: "Government", territory: "United Kingdom", city: "Elmstead", website: "elmstead.gov.uk", employees: "501-1000", revenue: 0, desc: "District council" },
  { id: "lumen", name: "Lumen Opticians", industry: "Health Care", territory: "United Kingdom", city: "Leicester", website: "lumenopticians.co.uk", employees: "51-200", revenue: 12000000, desc: "Independent opticians, 22 branches" },
  { id: "corvid", name: "Corvid Analytics", industry: "Analytics", territory: "United Kingdom", city: "Cambridge", website: "corvidanalytics.com", employees: "11-50", revenue: 4200000, desc: "Retail footfall analytics" },
  { id: "tidewater", name: "Tidewater Marine", industry: "Manufacturing", territory: "United Kingdom", city: "Plymouth", website: "tidewatermarine.co.uk", employees: "51-200", revenue: 19000000, desc: "Boat builder and marine engineering" },
  { id: "arden", name: "Arden Wealth", industry: "Financial Services", territory: "United Kingdom", city: "London", website: "ardenwealth.co.uk", employees: "11-50", revenue: 9000000, desc: "Wealth manager for professionals" },
  { id: "clearwater", name: "Clearwater Dental Group", industry: "Health Care", territory: "United Kingdom", city: "Leeds", website: "clearwaterdental.co.uk", employees: "201-500", revenue: 30000000, desc: "Dental practices across Yorkshire" },
  { id: "pinecrest", name: "Pinecrest Academy Trust", industry: "Education", territory: "United Kingdom", city: "Derby", website: "pinecrest.org.uk", employees: "201-500", revenue: 24000000, desc: "Academy trust of five secondary schools" },
  { id: "harrowlane", name: "Harrow Lane Bakeries", industry: "Food", territory: "United Kingdom", city: "London", website: "harrowlanebakeries.co.uk", employees: "51-200", revenue: 8500000, desc: "Bakeries and cafés across north-west London" },
  { id: "vantage", name: "Vantage Physio", industry: "Health Care", territory: "United Kingdom", city: "Brighton", website: "vantagephysio.co.uk", employees: "11-50", revenue: 2400000, desc: "Physiotherapy clinics in Sussex" },
  { id: "granite", name: "Granite & Grain", industry: "Retail", territory: "United Kingdom", city: "Aberdeen", website: "graniteandgrain.co.uk", employees: "11-50", revenue: 3600000, desc: "Kitchen and homeware shop" },
  { id: "sable", name: "Sable Street Records", industry: "Media", territory: "United Kingdom", city: "Glasgow", website: "sablestreet.co.uk", employees: "1-10", revenue: 900000, desc: "Independent record label" },
];

// deals: [company, title, value, currency, created, closed, status, lostReason, notes]
const DEALS = [
  ["calder", "Site and consultation booking", 52000, "GBP", "2025-05-19", "2025-06-20", "Won"],
  ["wexford", "Accessibility audit", 6800, "GBP", "2025-05-28", "2025-06-27", "Won"],
  ["copperleaf", "Brand identity", 41000, "GBP", "2025-07-14", "2025-08-28", "Won"],
  ["hollowoak", "Brand refresh workshop", 4200, "GBP", "2025-08-04", "2025-08-29", "Won"],
  ["northstar", "Website replatform", 146000, "GBP", "2025-07-21", "2025-09-19", "Won"],
  ["bluefern", "Booking engine", 64000, "GBP", "2025-08-11", "2025-10-17", "Lost", "Competition", "Went with their PMS vendor's own booking engine"],
  ["ferryman", "Driver app audit", 7200, "GBP", "2025-09-22", "2025-10-24", "Won"],
  ["aldermoor", "Phase 2 discovery: repairs reporting", 9600, "GBP", "2025-10-13", "2025-11-14", "Won"],
  ["elmstead", "Planning applications service", 120000, "GBP", "2025-09-08", "2025-12-12", "Lost", "Long Sales Cycle", "Procurement moved to a framework we are not on"],
  ["fernhill", "Field app v2", 118000, "GBP", "2025-10-20", "2025-12-05", "Won"],
  ["aldermoor", "Support retainer 2026", 54000, "GBP", "2025-11-24", "2025-12-12", "Won", null, null, true],
  ["lumen", "Online booking and recalls", 38000, "GBP", "2025-11-10", "2026-01-23", "Lost", "Pricing", "Chose a cheaper template product"],
  ["mosaic", "Design sprint: tutor matching", 8800, "GBP", "2026-01-12", "2026-01-30", "Won"],
  ["osprey", "Appointment booking", 74000, "GBP", "2025-12-08", "2026-02-13", "Won"],
  ["pennant", "Discovery sprint: assistance booking", 12500, "GBP", "2026-01-26", "2026-02-27", "Won"],
  ["corvid", "Customer dashboards", 46000, "GBP", "2026-01-19", "2026-03-06", "Lost", "No Decision-Maker", "Their CTO left mid-way"],
  ["quayside", "Member app", 36000, "GBP", "2026-01-28", "2026-03-13", "Lost", "Budget Constraints", "Board froze discretionary spend for the year"],
  ["larkspur", "Ordering app", 184000, "GBP", "2026-01-21", "2026-03-20", "Won"],
  ["fernhill", "Depot dashboard add-on", 15000, "GBP", "2026-03-09", "2026-04-03", "Won"],
  ["northstar", "Care plan", 24000, "GBP", "2026-03-30", "2026-04-17", "Won"],
  ["tidewater", "Dealer portal", 52000, "GBP", "2026-02-23", "2026-04-24", "Lost", "Unresponsive Prospect", null],
  ["meridian", "Design system", 96000, "USD", "2026-03-23", "2026-05-11", "Won"],
  ["thistle", "Made-to-measure prototype", 9600, "GBP", "2026-04-27", "2026-05-29", "Won"],
  ["arden", "Client portal", 58000, "GBP", "2026-04-13", "2026-06-05", "Lost", "Poor Fit", "Needs an FCA-regulated platform partner, not a studio"],
  ["clearwater", "Patient app", 72000, "GBP", "2026-05-11", "2026-07-03", "Lost", "Pricing", null],
  ["kinfolk", "UX review: carer rota app", 5400, "GBP", "2026-06-29", "2026-07-31", "Won"],
  ["pinecrest", "Parent portal", 31000, "GBP", "2026-06-08", "2026-07-24", "Lost", "Budget Constraints", null],
  ["harrowlane", "Ordering app", 48000, "GBP", "2026-06-22", "2026-08-28", "Lost", "Competition", "Picked the agency that built Larkspur's competitor"],
  ["vantage", "Booking site", 14000, "GBP", "2026-07-20", "2026-09-04", "Lost", "Unresponsive Prospect", null],
  ["bellwether", "Design review: device setup", 12000, "USD", "2026-08-24", "2026-09-25", "Won"],
  ["granite", "Online shop", 22000, "GBP", "2026-08-10", "2026-09-30", "Lost", "Other", "Went with an off-the-shelf shop and did it themselves"],
  ["sable", "Label website", 9000, "GBP", "2026-09-07", "2026-10-09", "Lost", "Pricing", null],
  ["saltmarsh", "Online shop", 38000, "GBP", "2026-09-14", "2026-10-28", "Won"],
  ["fernhill", "Field app v3 retainer", 60000, "GBP", "2026-09-28", null, "Ready to Close", null, null, true, "2026-11-30", "Contract signature with procurement, w/c 16 Nov"],
  ["meridian", "Design system phase 2", 142000, "USD", "2026-09-21", null, "Negotiation", null, null, false, "2026-12-15", "Scope call with Luis on 12 Nov"],
  ["kestrel-health", "Patient portal", 86000, "GBP", "2026-09-02", null, "Proposal/Quotation", null, null, false, "2026-12-12", "Proposal review call, 18 Nov"],
  ["oakvale", "Repairs and rent self-service", 42000, "GBP", "2026-10-05", null, "Demo/Making", null, null, false, "2027-01-20", "Workshop with their tenants' panel"],
  ["brightwater", "Parent and pupil portal", 24000, "GBP", "2026-10-26", null, "Qualification", null, null, false, "2027-02-01", "Find out who signs off budgets over £20k"],
];

const STAGES = ["Qualification", "Demo/Making", "Proposal/Quotation", "Negotiation", "Ready to Close"];

export function buildCRM(ctx) {
  const r = rng("crm");
  const companies = [];
  const contacts = [];
  const leads = [];
  const deals = [];
  const items = []; // timeline items
  const used = new Set();
  const personName = () => {
    for (;;) {
      const n = [r.pick(FIRST), r.pick(LAST)];
      const k = n.join(" ");
      if (!used.has(k)) { used.add(k); return n; }
    }
  };
  // fixed named contacts from the story
  const FIXED = {
    larkspur: [["Owen", "Tate", "Head of Digital"]], meridian: [["Dana", "Whitaker", "VP Product", "@dana-whitaker"], ["Luis", "Ortega", "Engineering Manager"]], "kestrel-health": [["Aisha", "Rahman", "Head of Digital", null, "Dr"], ["Ben", "Okoye", "Clinical Safety Officer"]],
    fernhill: [["Priyanka", "Shah", "Product Director"]], copperleaf: [["Freja", "Holm", "Managing Partner"]], oakvale: [["Martin", "Cole", "Digital Services Manager"]], brightwater: [["Helen", "Marsh", "Operations Director"]],
    quayside: [["Marcus", "Lee", "Chief Executive"]], saltmarsh: [["Tobias", "Wren", "Founder"]], aldermoor: [["Jo", "Bates", "Head of Digital"], ["Rachel", "Pearce", "Repairs Service Lead"]], wexford: [["Amelia", "Grant", "Head of Digital"]],
  };
  for (const v of Object.values(FIXED)) for (const f of v) used.add(f[0] + " " + f[1]);
  const allCos = [...ctx.customers.map((c) => ({ ...c, customer: true })), ...PROSPECTS.map((p) => ({ ...p, customer: false }))];
  for (const c of allCos) {
    const co = { id: c.id, name: c.name, website: c.website, industry: c.industry, territory: c.territory, employees: c.employees, annualRevenue: c.revenue, currency: c.currency || "GBP", description: c.desc,
      onCapxul: !!c.handle, handle: c.handle || null, safe: c.handle ? ctx.customerSafe(c) : null, isCustomer: c.customer, address: c.city ? `${c.city}, ${c.territory}` : null };
    companies.push(co);
    const n = FIXED[c.id] ? FIXED[c.id].length : r.int(1, 2);
    for (let i = 0; i < n; i++) {
      const f = FIXED[c.id]?.[i];
      const [first, last] = f ? [f[0], f[1]] : personName();
      const domain = c.website.replace(/^www\./, "");
      const ct = {
        id: slug(first + "-" + last), firstName: first, lastName: last, name: `${f?.[4] ? f[4] + " " : ""}${first} ${last}`, company: c.id, designation: f ? f[2] : r.pick(TITLES),
        email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`.replace(/[^a-z0-9.@-]/g, ""), mobile: c.territory === "United Kingdom" ? `+44 7700 9${String(r.int(10000, 99999))}` : c.territory === "United States" ? `+1 617 555 0${r.int(100, 199)}` : `+45 20 ${r.int(10, 99)} ${r.int(10, 99)} ${r.int(10, 99)}`,
        onCapxul: !!f?.[3], handle: f?.[3] || null, primary: i === 0, createdAt: null,
      };
      contacts.push(ct);
    }
  }
  // people with no company
  contacts.push({ id: "ian-pryce", firstName: "Ian", lastName: "Pryce", name: "Ian Pryce", company: null, designation: "Freelance consultant", email: "ian.pryce@outlook.com", mobile: "+44 7700 900871", onCapxul: false, handle: null, primary: false, note: "Referred Kestrel Health. A referral fee of 1,900 USDC waits for him to claim it." });
  contacts.push({ id: "jules-marchetti", firstName: "Jules", lastName: "Marchetti", name: "Jules Marchetti", company: null, designation: "Illustrator", email: "jules.marchetti@proton.me", mobile: "+33 6 12 34 56 78", onCapxul: false, handle: null, primary: false });
  contacts.push({ id: "sam-hollis", firstName: "Sam", lastName: "Hollis", name: "Sam Hollis", company: null, designation: "Accountant, Hollis & Reed", email: "sam@hollisreed.co.uk", mobile: "+44 7700 900654", onCapxul: true, handle: "@samhollis", primary: false });

  const owners = (d) => (d < "2026-01-12" ? ["samw", "samw", "maya"] : d < "2026-07-06" ? ["samw", "leo", "samw"] : ["samw", "leo", "zara"]);
  const writer = (d) => { const p = ctx.officerHolders("people", d).filter((x) => x === "samw" || x === "kwame"); return p.includes("samw") ? "samw" : p[0]; };
  const coOf = (id) => companies.find((c) => c.id === id);
  const contactsOf = (id) => contacts.filter((c) => c.company === id);
  const need = (co) => r.pick(NEED[co.industry] || ["a new digital product"]);
  const time = (d, h0 = 9, h1 = 17) => at(d, r.int(h0, h1), r.int(0, 59), r.int(0, 59));
  const wd = (d) => { while (!isWorking(d)) d = addDays(d, 1); return d; };
  const clampNow = (t) => (t > NOW ? at(TODAY, r.int(7, 9), r.int(0, 59), r.int(0, 59)) : t);
  const push = (rec, kind, t, data) => { if (t > NOW) return null; const it = { record: rec, kind, at: t, ...data }; items.push(it); return it; };

  function leadTimeline(lead, co, ct, endDate, convertedTo) {
    const d0 = lead.createdAt.slice(0, 10);
    const w = writer(d0);
    push(lead, "creation", lead.createdAt, { by: w, text: `${ctx.personName(w)} created this lead`, source: lead.source });
    const n = lead.deal ? needOf(lead.deal.subject) : need(co);
    lead._need = n;
    if (lead.source === "Website" || lead.source === "Email") {
      push(lead, "email", addMin(lead.createdAt, -r.int(30, 600)), { direction: "in", from: ct.email, fromName: ct.name, to: ["hello@harbourline.studio"], subject: `${cap(n)} for ${co.name}`,
        body: `Hello Harbourline,\n\nI'm ${ct.designation.toLowerCase().startsWith("head") || ct.designation.includes("Director") ? "the " + ct.designation : ct.designation} at ${co.name}. ${co.description}. We're looking for a studio to help with ${n}${lead.source === "Website" ? ", and your work for " + r.pick(["Fernhill Energy", "Northstar Retail", "Aldermoor Housing Trust", "Copperleaf"]) + " caught our eye" : ""}.\n\nCould we have a call in the next week or two?\n\nBest,\n${ct.firstName}`, attachments: [] });
    } else if (lead.source === "Reference") {
      push(lead, "note", addMin(lead.createdAt, 4), { by: w, title: "Introduction", content: `Introduced by ${lead.company === "kestrel-health" ? "Ian Pryce (freelance consultant; referral fee agreed)" : r.pick(["Priyanka Shah at Fernhill", "Owen Tate at Larkspur", "Ian Pryce (freelance)", "Jo Bates at Aldermoor", "a friend of Maya's"])}. ${ct.name} is looking at ${n}.` });
    } else if (lead.source === "Exhibition") {
      push(lead, "note", addMin(lead.createdAt, 4), { by: w, title: "Met at the stand", content: `Met ${ct.firstName} at ${r.pick(["UX London", "Retail Technology Show", "Digital Health Rewired", "Housing 2026 in Manchester", "Design Week"])}. Interested in ${n}. Follow up within a week.` });
    }
    const steps = [];
    let d = wd(addDays(d0, r.int(1, 4)));
    if (d > endDate) return;
    push(lead, "changed", time(d), { by: w, field: "Status", from: "New", to: "Contacted", text: `${ctx.personName(w)} changed Status from New to Contacted` });
    push(lead, "email", time(d), { direction: "out", from: `${ctx.emailOf(lead.owner)}`, fromName: ctx.personName(lead.owner), to: [ct.email], subject: `Re: ${cap(n)} for ${co.name}`, body: `Hi ${ct.firstName},\n\nThanks for getting in touch. We'd love to hear more. Are you free for 30 minutes on ${weekday(wd(addDays(d, 2)))} or ${weekday(wd(addDays(wd(addDays(d, 2)), 1)))}? I've attached a short deck with similar work.\n\n${ctx.personName(lead.owner).split(" ")[0]}`, attachments: [{ name: "Harbourline-capabilities-2026.pdf", size: "3.4 MB" }] });
    d = wd(addDays(d, r.int(3, 8)));
    if (d > endDate) return;
    const answered = r.chance(0.85);
    push(lead, "call", time(d, 10, 16), { by: w, type: "Outgoing", status: answered ? "Completed" : "No Answer", duration: answered ? r.int(900, 2700) : 0, caller: ctx.personName(lead.owner), receiver: ct.name, note: answered ? `Discovery call: ${discovery(co, n, r)}` : null });
    if (answered) push(lead, "note", time(d, 16, 17), { by: w, title: "Discovery call", content: discovery(co, n, r) + ` Budget ${r.pick(["not fixed yet", "signed off for this year", "depends on the board in " + monthName(addDays(d, 40)), "around £" + r.int(2, 15) * 5 + "k"])}.` });
    if (ct.mobile && r.chance(0.5)) push(lead, "whatsapp", time(d, 17, 18), { direction: "out", from: "Harbourline", to: ct.mobile, text: `Thanks for the call today ${ct.firstName}. I'll send over a couple of case studies tomorrow.`, status: "read" });
    if (convertedTo) {
      const cd = convertedTo.createdAt.slice(0, 10);
      push(lead, "changed", time(addDays(cd, -1)), { by: w, field: "Status", from: "Contacted", to: "Qualified", text: `${ctx.personName(w)} changed Status from Contacted to Qualified` });
      push(lead, "converted", convertedTo.createdAt, { by: w, text: `${ctx.personName(w)} converted the lead to this deal`, deal: convertedTo });
    } else {
      const finalD = minDate(endDate, wd(addDays(d, r.int(5, 30))));
      if (lead.status !== "Contacted") push(lead, "changed", time(finalD), { by: w, field: "Status", from: "Contacted", to: lead.status, text: `${ctx.personName(w)} changed Status from Contacted to ${lead.status}` });
      if (lead.status === "Nurture") push(lead, "task", time(finalD), { by: w, title: `Check in with ${ct.firstName} in ${monthName(addDays(finalD, 60))}`, description: "Budget is next financial year. Send the new case studies first.", status: lead.modifiedTo > TODAY ? "Todo" : r.pick(["Todo", "Backlog"]), priority: "Low", assignedTo: lead.owner, due: at(addDays(finalD, 60), 17, 0) });
      if (lead.status === "Unqualified") lead.lostReason = r.pick(["Budget Constraints", "Poor Fit", "Long Sales Cycle", "No Decision-Maker"]);
    }
  }

  function dealTimeline(deal, co, cts) {
    const ct = cts[0];
    const w = writer(deal.createdAt.slice(0, 10));
    let d = deal.createdAt.slice(0, 10);
    if (!deal.lead) push(deal, "creation", deal.createdAt, { by: w, text: `${ctx.personName(w)} created this deal` });
    push(deal, "task", addMin(deal.createdAt, 25), { by: w, title: "Send capability deck and two case studies", description: "", status: "Done", priority: "Medium", assignedTo: deal.owner, due: at(addDays(d, 2), 17, 0) });
    const endIdx = deal.status === "Won" ? 5 : deal.status === "Lost" ? r.int(1, 3) : STAGES.indexOf(deal.status);
    const end = deal.closedDate || TODAY;
    const span = Math.max(8, daysBetween(d, end));
    let prev = "Qualification";
    for (let i = 1; i <= Math.min(endIdx, 4); i++) {
      const sd = wd(addDays(deal.createdAt.slice(0, 10), Math.round((span * i) / (endIdx + 1.2))));
      if (sd > TODAY) break;
      const st = STAGES[i];
      if (st === "Demo/Making") {
        push(deal, "call", time(sd, 10, 15), { by: w, type: "Outgoing", status: "Completed", duration: r.int(1800, 3600), caller: ctx.personName(deal.owner), receiver: ct.name, note: `Workshop on ${(deal._need || needOf(deal.subject)).replace(/^an? /, "the ")}: walked through ${r.pick(["Northstar's checkout", "the Fernhill field app", "Aldermoor's tenant portal", "Larkspur's ordering flow"])}; they want a plan in phases.` });
        if (ct.mobile && r.chance(0.6)) push(deal, "whatsapp", time(addDays(sd, -2), 8, 9), { direction: "in", from: ct.mobile, fromName: ct.name, to: "Harbourline", text: r.pick(["Thursday works, see you at 2", "Running 10 minutes late, sorry!", "Can we move to the afternoon?", "Great, see you then"]), status: "received" });
      }
      if (st === "Proposal/Quotation") {
        push(deal, "email", time(sd), { direction: "out", from: ctx.emailOf(deal.owner), fromName: ctx.personName(deal.owner), to: cts.map((c) => c.email), subject: `${co.name}: our proposal`, body: `Hi ${ct.firstName},\n\nAs promised, here's our proposal for ${needOf(deal.subject).replace(/^an? /, "the ")}: the phases, the team, and a fixed price for the first phase with time and materials after. Happy to walk you through it.\n\n${ctx.personName(deal.owner).split(" ")[0]}`, attachments: [{ name: `${slug(co.name)}-proposal-v${r.int(1, 3)}.pdf`, size: `${(r.float(1.2, 4.8)).toFixed(1)} MB` }] });
        push(deal, "changes", time(addDays(sd, 1)), { by: w, changes: [["Status", prev, st], ["Deal Value", null, money(deal.dealValue, deal.currency)], ["Probability", null, "50"]], text: `Show +3 changes from ${ctx.personName(w)}` });
        if (r.chance(0.7)) push(deal, "email", time(wd(addDays(sd, r.int(3, 9)))), { direction: "in", from: ct.email, fromName: ct.name, to: [ctx.emailOf(deal.owner)], subject: `Re: ${co.name}: our proposal`, body: `Thanks, this is really clear. ${r.pick(["A few questions on the timeline", "Our finance team asked about payment terms", "Could the first phase start in January?", "Can we include accessibility testing with real users?"])}: can we talk this week?\n\n${ct.firstName}`, attachments: [] });
        prev = st;
        continue;
      }
      if (st === "Negotiation") push(deal, "call", time(sd, 11, 16), { by: w, type: r.pick(["Outgoing", "Incoming"]), status: "Completed", duration: r.int(900, 2400), caller: ctx.personName(deal.owner), receiver: ct.name, note: `Talked price and start date. ${r.pick(["They want 10% off the first phase", "They asked for monthly invoicing", "Agreed to split discovery out", "Procurement needs our insurance certificates"])}.` });
      push(deal, "changed", time(sd), { by: w, field: "Status", from: prev, to: st, text: `${ctx.personName(w)} changed Status from ${prev} to ${st}` });
      prev = st;
    }
    if (deal.status === "Won") {
      push(deal, "changed", time(deal.closedDate), { by: w, field: "Status", from: prev, to: "Won", text: `${ctx.personName(w)} changed Status from ${prev} to Won` });
      push(deal, "note", time(deal.closedDate, 16, 18), { by: w, title: "Won", content: `Signed. ${deal.project ? "Kick-off on " + longDate(ctx.projectsDef.find((p) => p.id === deal.project).start) + "; project " + deal.project + "." : "Invoice on delivery."} ${ct.name} is the day-to-day contact.` });
    } else if (deal.status === "Lost") {
      push(deal, "changed", time(deal.closedDate), { by: w, field: "Status", from: prev, to: "Lost", text: `${ctx.personName(w)} changed Status from ${prev} to Lost` });
      push(deal, "email", time(deal.closedDate, 9, 12), { direction: "in", from: ct.email, fromName: ct.name, to: [ctx.emailOf(deal.owner)], subject: `Re: ${co.name}`, body: `Hi,\n\nThank you for all the time you put in. ${deal.lostNotes || "We've decided not to go ahead for now."} I hope we can work together another time.\n\n${ct.firstName}`, attachments: [] });
    } else {
      // open deals: what is next
      const due = addDays(TODAY, r.int(2, 10));
      push(deal, "task", time(addDays(TODAY, -r.int(1, 6))), { by: w, title: deal.nextStep, description: "", status: r.pick(["Todo", "In Progress"]), priority: r.pick(["High", "Medium"]), assignedTo: deal.owner, due: at(due, 17, 0) });
    }
  }

  // ---------- deals and their leads ----------
  let leadSeq = 0;
  for (const [coId, title, value, currency, created, closed, status, reason, notes, direct, expected, nextStep] of DEALS) {
    const co = coOf(coId);
    const cts = contactsOf(coId);
    const owner = value >= 60000 ? r.pick(owners(created).filter((x) => x !== "zara")) : r.pick(owners(created));
    const deal = {
      title: `${co.name}: ${title}`, subject: title, _type: "Deal", company: coId, contacts: cts.map((c, i) => ({ contact: c.id, primary: i === 0 })), status, probability: DEAL_STATUSES.find((s) => s.name === status).probability,
      dealValue: value, currency, expectedDealValue: status === "Won" || status === "Lost" ? null : Math.round(value * DEAL_STATUSES.find((s) => s.name === status).probability / 100), expectedClosureDate: expected || closed,
      closedDate: status === "Won" || status === "Lost" ? closed : null, nextStep: nextStep || null, owner, lostReason: reason || null, lostNotes: notes || null, createdAt: at(created, r.int(9, 16), r.int(0, 59)),
      source: null, territory: co.territory, industry: co.industry, project: ctx.projectsDef.find((p) => p.customer === coId && Math.abs(daysBetween(p.start, closed || TODAY)) < 75 && p.start >= (closed || "2000"))?.id || null, lead: null,
    };
    if (coId === "aldermoor" && title.startsWith("Support")) deal.project = "PROJ-0009";
    if (coId === "northstar" && title === "Care plan") deal.project = null;
    // a won or open deal for a time-and-materials project is worth what the project bills
    const pd = deal.project && ctx.projectsDef.find((p) => p.id === deal.project);
    if (pd && pd.billing === "tm" && pd.projectedValue) deal.dealValue = pd.projectedValue;
    if (deal.expectedDealValue !== null) deal.expectedDealValue = Math.round(deal.dealValue * deal.probability / 100);
    deals.push(deal);
    if (!direct) {
      const ld = addDays(created, -r.int(8, 30));
      const repeat = deals.filter((x) => x.company === coId).length > 1 || ["fernhill", "aldermoor"].includes(coId);
      const lead = { _type: "Lead", createdAt: time(wd(maxDate(ld, START))), company: coId, org: co.name, contact: cts[0], status: "Qualified", converted: true, owner, source: coId === "kestrel-health" ? "Reference" : repeat ? "Existing Customer" : r.weighted(SOURCES.filter(([s]) => s !== "Existing Customer")) };
      deal.source = lead.source;
      deal.lead = lead;
      lead.deal = deal;
      leads.push(lead);
    } else deal.source = "Existing Customer";
  }
  // leads that did not convert
  const want = 118 - leads.length;
  const statusMix = [["Unqualified", 30], ["Junk", 19], ["Nurture", 14], ["Contacted", 10], ["New", 9]];
  const pool = [...companies.filter((c) => !c.isCustomer), ...companies.filter((c) => !c.isCustomer)];
  for (let i = 0; i < want; i++) {
    const status = r.weighted(statusMix);
    const late = status === "New" || status === "Contacted";
    const d = late ? addDays(TODAY, -r.int(1, status === "New" ? 9 : 40)) : addDays(START, Math.floor(Math.pow(r.next(), 0.8) * daysBetween(START, addDays(TODAY, -45))));
    const junk = status === "Junk";
    const [first, last] = personName();
    const orgName = junk ? r.pick(["SEO Boost Ltd", "Crypto Growth Partners", "Global Outsourcing Hub", "Rank1 Marketing", "(none)", "Webinar Leads Co"]) : r.chance(0.35) ? pool[i % pool.length].name : r.pick(["Northcote Dental", "Hartwell Gin", "Kingfisher Lettings", "Arrow Valley Cycles", "Moorland Walks", "Linden Care Homes", "Foxglove Florists", "Riverbank Nurseries", "Westgate Cinemas", "Juniper Yoga", "Ashby & Co Solicitors", "Bramble Pet Insurance", "Halcyon Spa", "Ironbridge Fitness", "Marlowe Theatre Trust", "Copper Kettle Cafés", "Oak & Ivy Interiors", "Tern Bicycles UK", "Seacroft Surgery", "Larch Learning"]);
    const co = companies.find((c) => c.name === orgName);
    const lead = {
      _type: "Lead", createdAt: clampNow(time(wd(maxDate(d, START)))), company: co ? co.id : null, org: orgName, contact: null, firstName: first, lastName: last,
      status, converted: false, owner: r.pick(owners(d)), source: junk ? r.pick(["Email", "Campaign", "Website"]) : r.weighted(co && co.isCustomer ? SOURCES : SOURCES.filter(([s]) => s !== "Existing Customer")),
      industry: co ? co.industry : r.pick(["Health Care", "Food", "Retail", "Hospitality", "Real Estate", "Education"]),
    };
    leads.push(lead);
  }
  leads.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const l of leads) {
    l.name = ctx.series.next(`CRM-LEAD-${l.createdAt.slice(0, 4)}-`);
    if (!l.contact) {
      const domain = l.org === "(none)" ? "gmail.com" : slug(l.org).replace(/-/g, "") + ".co.uk";
      l.firstName = l.firstName || "Alex";
      l.email = `${l.firstName.toLowerCase()}@${domain}`.replace(/[^a-z0-9.@]/g, "");
      l.mobile = r.chance(0.6) ? `+44 7700 9${String(r.int(10000, 99999))}` : null;
      l.jobTitle = r.pick(TITLES);
    } else {
      l.firstName = l.contact.firstName; l.lastName = l.contact.lastName; l.email = l.contact.email; l.mobile = l.contact.mobile; l.jobTitle = l.contact.designation;
    }
    const co = l.company ? coOf(l.company) : null;
    l.website = co ? co.website : null;
    l.territory = co ? co.territory : "United Kingdom";
    l.industry = l.industry || (co ? co.industry : null);
    l.employees = co ? co.employees : r.pick(["1-10", "11-50", "51-200"]);
    const end = l.deal ? l.deal.createdAt.slice(0, 10) : TODAY;
    const fakeCo = co || { name: l.org, description: `${l.org} is a ${(l.industry || "small").toLowerCase()} business`, industry: l.industry };
    const ct = l.contact || { firstName: l.firstName, name: `${l.firstName} ${l.lastName}`, email: l.email, mobile: l.mobile, designation: l.jobTitle };
    if (l.status === "Junk") {
      push(l, "creation", l.createdAt, { by: writer(l.createdAt.slice(0, 10)), text: `${ctx.personName(writer(l.createdAt.slice(0, 10)))} created this lead`, source: l.source });
      push(l, "email", addMin(l.createdAt, -r.int(30, 300)), { direction: "in", from: l.email, fromName: `${l.firstName} ${l.lastName}`, to: ["hello@harbourline.studio"], subject: r.pick(["Partnership opportunity", "Get 300% more traffic", "Quick question about your website", "Outsourcing proposal"]), body: "Hi,\n\nWe help agencies like yours grow fast with our proven services. Reply YES to learn more.\n\nRegards", attachments: [] });
      push(l, "changed", addMin(l.createdAt, r.int(60, 2000)), { by: writer(l.createdAt.slice(0, 10)), field: "Status", from: "New", to: "Junk", text: `${ctx.personName(writer(l.createdAt.slice(0, 10)))} changed Status from New to Junk` });
    } else if (l.status === "New") {
      push(l, "creation", l.createdAt, { by: writer(l.createdAt.slice(0, 10)), text: `${ctx.personName(writer(l.createdAt.slice(0, 10)))} created this lead`, source: l.source });
      const n = need(fakeCo);
      push(l, "email", addMin(l.createdAt, -r.int(30, 300)), { direction: "in", from: l.email, fromName: `${l.firstName} ${l.lastName}`, to: ["hello@harbourline.studio"], subject: `${cap(n)}`, body: `Hello,\n\nWe're ${l.org}. We're starting to look at ${n} and would like to talk to a couple of studios. Do you have time next week?\n\n${l.firstName}`, attachments: [] });
      push(l, "task", addMin(l.createdAt, 15), { by: writer(l.createdAt.slice(0, 10)), title: `Reply to ${l.firstName} at ${l.org}`, description: "", status: "Todo", priority: "High", assignedTo: l.owner, due: at(addDays(l.createdAt.slice(0, 10), 2), 17, 0) });
    } else leadTimeline(l, fakeCo, ct, end, l.deal || null);
    l.modifiedAt = items.filter((it) => it.record === l).map((it) => it.at).sort().slice(-1)[0] || l.createdAt;
    if (l.status === "Qualified") l.status = "Qualified";
  }
  deals.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const d of deals) {
    d.name = ctx.series.next(`CRM-DEAL-${d.createdAt.slice(0, 4)}-`);
    if (d.lead) { d.lead.convertedTo = d.name; d._need = d.lead._need; }
    dealTimeline(d, coOf(d.company), contactsOf(d.company));
  }
  // the money the chain proves, on the deals and companies of parties on Capxul
  ctx.crmMoney = (payments) => {
    for (const p of payments) {
      if (p.direction !== "in" || !["meridian", "bellwether", "copperleaf"].some((c) => (p.counterparty || "").startsWith(coOf(c).name))) continue;
      const coId = ["meridian", "bellwether", "copperleaf"].find((c) => (p.counterparty || "").startsWith(coOf(c).name));
      const deal = deals.filter((d) => d.company === coId && d.status === "Won").sort((a, b) => (a.closedDate < b.closedDate ? 1 : -1)).find((d) => d.closedDate <= p.sentAt.slice(0, 10)) || deals.find((d) => d.company === coId);
      push(deal, "money", p.sentAt, { direction: "in", amount: p.amount, asset: "USDC", payment: p.id, text: `${coOf(coId).name} paid ${p.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} USDC`, invoice: p.proof?.advice?.allocations?.[0]?.doc || null, documentHash: p.proof?.documentHash || null, tx: p.proof?.tx || null, block: p.proof?.block || null, company: coId });
    }
    const ian = payments.find((p) => p._esc && p._esc.email === "ian.pryce@outlook.com");
    if (ian) items.push({ record: { _type: "Contact", contact: "ian-pryce" }, kind: "money", at: ian.sentAt, direction: "out", amount: ian.amount, asset: "USDC", payment: ian.id, text: `${ian.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} USDC sent from Growth · waiting to be claimed`, escrow: true, documentHash: ian.proof?.documentHash || null });
  };
  return { companies, contacts, leads, deals, items, statuses: { lead: LEAD_STATUSES, deal: DEAL_STATUSES }, lostReasons: LOST_REASONS };
}

export function finishCRM(crm, ctx) {
  // ids for items, split by kind into Frappe's own records, record references as names
  let n = 0;
  const notes = [];
  const tasks = [];
  const calls = [];
  const emails = [];
  const whatsapp = [];
  crm.items.sort((a, b) => (a.at < b.at ? -1 : 1));
  for (const it of crm.items) {
    it.id = "act_" + String(++n).padStart(5, "0");
    const rec = it.record;
    it.recordType = rec._type;
    it.recordName = rec._type === "Contact" ? rec.contact : rec.name;
    delete it.record;
    if (it.deal) it.deal = it.deal.name;
    if (it.kind === "note") notes.push({ name: `note_${n}`, title: it.title, content: it.content, by: it.by, at: it.at, reference: it.recordName, referenceType: it.recordType });
    if (it.kind === "task") tasks.push({ name: `CRM-TASK-${String(tasks.length + 1).padStart(5, "0")}`, title: it.title, description: it.description, status: it.status, priority: it.priority, assignedTo: it.assignedTo, due: it.due, at: it.at, by: it.by, reference: it.recordName, referenceType: it.recordType });
    if (it.kind === "call") calls.push({ name: `CALL-${String(calls.length + 1).padStart(5, "0")}`, type: it.type, status: it.status, duration: it.duration, caller: it.caller, receiver: it.receiver, note: it.note, at: it.at, by: it.by, reference: it.recordName, referenceType: it.recordType });
    if (it.kind === "email") emails.push(it.id);
    if (it.kind === "whatsapp") whatsapp.push(it.id);
  }
  // a deal's timeline starts with its lead's
  for (const l of crm.leads) {
    l.contact = l.contact ? l.contact.id : null;
    l.deal = l.deal ? l.deal.name : null;
    delete l._need;
  }
  for (const d of crm.deals) {
    d.lead = d.lead ? d.lead.name : null;
    delete d._need;
  }
  crm.notes = notes;
  crm.tasks = tasks;
  crm.calls = calls;
  crm.timeline = crm.items;
  delete crm.items;
  crm.counts = { emails: emails.length, whatsapp: whatsapp.length };
}

function addMin(t, n) {
  return new Date(Date.parse(t) + n * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function needOf(subject) {
  const t = /^[A-Z][a-z]/.test(subject) ? subject.charAt(0).toLowerCase() + subject.slice(1) : subject;
  if (/s$/.test(t.split(":")[0]) && !/ss$/.test(t.split(":")[0])) return t;
  return (/^[aeiou]/i.test(t) ? "an " : "a ") + t;
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function weekday(d) {
  return new Date(Date.parse(d)).toLocaleString("en-GB", { weekday: "long", timeZone: "UTC" });
}
function monthName(d) {
  return new Date(Date.parse(d)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
}
function longDate(d) {
  return new Date(Date.parse(d)).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
function money(v, c) {
  return (c === "USD" ? "$" : "£") + v.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}
function discovery(co, n, r) {
  const bits = {
    "Health Care": ["NHS DSP Toolkit and DCB0129 matter", "WCAG 2.2 AA is a must", "pilot in three clinics first"],
    Food: ["14 shops, Square at the tills", "loyalty is the main ask", "launch before Christmas"],
    "Real Estate": ["tenants mostly on phones", "repairs are the top complaint", "housing system has an old SOAP API"],
    Retail: ["18,000 SKUs", "click and collect drives a third of sales", "peak is November"],
    Education: ["parents first, then pupils", "safeguarding review needed", "start in September"],
    Software: ["their own design team of four", "React and a token pipeline", "US working hours for calls"],
  }[co.industry] || ["small team on their side", "wants a phased plan", "decision by the end of the quarter"];
  return `${cap(n)}. ${r.sample(bits, 2).map(cap).join(". ")}.`;
}
