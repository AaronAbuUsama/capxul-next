// Harbourline's fixed facts: the company, its people and their hats, its customers, suppliers and projects.
// Everything that is a judgement about the story lives here; the other modules derive numbers from it.

export const COMPANY = {
  name: "Harbourline Studio Ltd",
  short: "Harbourline",
  handle: "@harbourline",
  orgId: "org_01JT2B9W5K3M8Q4R7V0X6Y1ZAH",
  domain: "harbourline.studio",
  address: "14 Hoxton Square, London N1 6NU",
  companyNumber: "14738215",
  vatNumber: "GB 412 8830 61",
  incorporated: "2023-03-06",
  onCapxulSince: "2025-05-01",
  currency: "GBP",
  timezone: "Europe/London",
  fiscalYearStart: "04-01",
  country: "United Kingdom",
  chain: { name: "Base", chainId: 8453, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", eurc: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" },
  industry: "Design and engineering studio",
  about: "A design and engineering studio of 25 in Hoxton: product design, apps and websites for UK and overseas clients.",
};

// People. `id` is the key every other record uses; `emp` the Employee number Frappe gives in joining order.
// base: monthly basic salary in GBP; raise: from 6 April 2026. paidTo: "safe" (USDC to their Capxul Safe) or "bank" (GBP via Bridge).
export const PEOPLE = [
  { id: "maya", first: "Maya", last: "Okafor", gender: "Female", dob: "1986-07-22", joined: "2023-03-06", dept: "operations", desig: "Founder and Managing Director", base: 6250, raise: 6500, paidTo: "safe", reportsTo: null, seat: "2025-05-01", personal: "maya.okafor@protonmail.com", mobile: "07700 900101", city: "London E8" },
  { id: "tom", first: "Tom", last: "Ashworth", gender: "Male", dob: "1988-02-11", joined: "2023-03-06", dept: "engineering", desig: "Engineering Lead", base: 6000, raise: 6250, paidTo: "safe", reportsTo: "maya", seat: "2025-05-01", personal: "tom.ashworth@fastmail.com", mobile: "07700 900102", city: "London N16", billable: 0.45 },
  { id: "ellis", first: "Ellis", last: "Hart", gender: "Male", dob: "1991-03-14", joined: "2023-09-04", dept: "engineering", desig: "Senior Software Engineer", base: 4000, raise: 4250, paidTo: "bank", bank: ["Monzo", "41829057", "04-00-04"], reportsTo: "tom", seat: "2026-11-02", personal: "ellis.hart@fastmail.com", mobile: "07700 900418", city: "London SE22", billable: 0.85 },
  { id: "lena", first: "Lena", last: "Fischer", gender: "Female", dob: "1990-10-02", joined: "2023-11-13", dept: "design", desig: "Senior Product Designer", base: 4100, raise: 4300, paidTo: "bank", bank: ["Starling", "18830241", "60-83-71"], reportsTo: "priya", seat: "2026-11-03", personal: "lena.fischer@posteo.de", mobile: "07700 900233", city: "London E2", billable: 0.82 },
  { id: "jamal", first: "Jamal", last: "Osei", gender: "Male", dob: "1994-05-30", joined: "2024-02-05", dept: "engineering", desig: "Software Engineer", base: 3600, raise: 3800, paidTo: "safe", reportsTo: "tom", seat: null, personal: "jamal.osei@gmail.com", mobile: "07700 900347", city: "London SE15", billable: 0.85 },
  { id: "amira", first: "Amira", last: "Haddad", gender: "Female", dob: "1995-12-08", joined: "2024-04-02", dept: "design", desig: "Product Designer", base: 3400, raise: 3550, paidTo: "bank", bank: ["Barclays", "70114583", "20-32-06"], reportsTo: "priya", seat: null, personal: "amira.haddad@outlook.com", mobile: "07700 900512", city: "London N4", billable: 0.84 },
  { id: "ben", first: "Ben", last: "Okoro", gender: "Male", dob: "1993-08-19", joined: "2024-06-03", dept: "engineering", desig: "Software Engineer", base: 3500, raise: 3650, paidTo: "bank", bank: ["Nationwide", "30487716", "07-01-16"], reportsTo: "tom", seat: null, personal: "ben.okoro@gmail.com", mobile: "07700 900618", city: "Walthamstow", billable: 0.85 },
  { id: "isla", first: "Isla", last: "Morgan", gender: "Female", dob: "1989-01-27", joined: "2024-07-01", dept: "delivery", desig: "Project Manager", base: 3700, raise: 3900, paidTo: "bank", bank: ["Lloyds", "52219830", "30-94-57"], reportsTo: "maya", seat: "2025-05-01", personal: "isla.morgan@icloud.com", mobile: "07700 900724", city: "London SE4", billable: 0.5 },
  { id: "josh", first: "Josh", last: "Pemberton", gender: "Male", dob: "1996-04-03", joined: "2024-09-02", dept: "engineering", desig: "Software Engineer", base: 3450, raise: 3600, paidTo: "safe", reportsTo: "tom", seat: null, personal: "josh.pemberton@gmail.com", mobile: "07700 900830", city: "London E9", billable: 0.85 },
  { id: "chloe", first: "Chloe", last: "Martin", gender: "Female", dob: "1992-06-15", joined: "2024-10-07", dept: "design", desig: "UX Researcher", base: 3300, raise: 3450, paidTo: "bank", bank: ["HSBC", "61540273", "40-11-62"], reportsTo: "priya", seat: null, personal: "chloe.martin@gmail.com", mobile: "07700 900936", city: "London N1", billable: 0.78 },
  { id: "oliver", first: "Oliver", last: "Grant", gender: "Male", dob: "1993-11-21", joined: "2024-11-04", relieved: "2025-08-29", dept: "engineering", desig: "Front-end Engineer", base: 3550, paidTo: "bank", bank: ["Santander", "22918406", "09-01-28"], reportsTo: "tom", seat: null, personal: "ol.grant@gmail.com", mobile: "07700 901042", city: "London SE5", billable: 0.85, exit: { resignation: "2025-07-25", interview: "2025-08-27", reason: "Moving to Bristol to be near family", newWorkplace: "Sparkline Labs, Bristol" } },
  { id: "freya", first: "Freya", last: "Lund", gender: "Female", dob: "1997-09-09", joined: "2025-01-06", dept: "design", desig: "Motion Designer", base: 3200, raise: 3350, paidTo: "bank", bank: ["Monzo", "73016648", "04-00-04"], reportsTo: "priya", seat: null, personal: "freya.lund@gmail.com", mobile: "07700 901148", city: "London E5", billable: 0.8 },
  { id: "samw", first: "Sam", last: "Whitfield", gender: "Male", dob: "1987-03-28", joined: "2025-02-03", dept: "growth", desig: "Business Development Manager", base: 3900, raise: 4050, paidTo: "bank", bank: ["NatWest", "48803317", "60-02-19"], reportsTo: "maya", seat: "2025-05-01", personal: "sam.whitfield@gmail.com", mobile: "07700 901254", city: "Richmond" },
  { id: "rosa", first: "Rosa", last: "Delgado", gender: "Female", dob: "1990-12-01", joined: "2025-03-03", dept: "operations", desig: "Office Coordinator", base: 2600, raise: 2750, paidTo: "bank", bank: ["Barclays", "90162745", "20-74-09"], reportsTo: "maya", seat: null, personal: "rosa.delgado@gmail.com", mobile: "07700 901360", city: "London N7" },
  { id: "priya", first: "Priya", last: "Raman", gender: "Female", dob: "1985-09-17", joined: "2025-05-12", dept: "design", desig: "Design Director", base: 5800, raise: 6000, paidTo: "safe", reportsTo: "maya", seat: "2025-05-12", personal: "priya.raman@fastmail.com", mobile: "07700 901466", city: "London N19", billable: 0.45 },
  { id: "kwame", first: "Kwame", last: "Mensah", gender: "Male", dob: "1984-06-05", joined: "2025-06-02", dept: "operations", desig: "Operations and People Lead", base: 4600, raise: 4800, paidTo: "bank", bank: ["Lloyds", "31740288", "30-90-89"], reportsTo: "maya", seat: "2025-06-02", personal: "kwame.mensah@gmail.com", mobile: "07700 901572", city: "Lewisham" },
  { id: "ravi", first: "Ravi", last: "Shah", gender: "Male", dob: "1991-01-12", joined: "2025-08-04", dept: "delivery", desig: "Delivery Manager", base: 4200, raise: 4350, paidTo: "safe", reportsTo: "grace", seat: "2026-11-02", personal: "ravi.shah@gmail.com", mobile: "07700 901678", city: "Harrow", billable: 0.6 },
  { id: "grace", first: "Grace", last: "Adeyemi", gender: "Female", dob: "1988-04-24", joined: "2025-10-06", dept: "delivery", desig: "Delivery Lead", base: 5200, raise: 5400, paidTo: "bank", bank: ["NatWest", "55021934", "60-40-05"], reportsTo: "maya", seat: "2025-10-06", personal: "grace.adeyemi@outlook.com", mobile: "07700 901784", city: "Peckham", billable: 0.3 },
  { id: "daniel", first: "Daniel", last: "Price", gender: "Male", dob: "1994-02-02", joined: "2025-11-03", relieved: "2026-03-31", dept: "design", desig: "Product Designer", base: 3500, paidTo: "bank", bank: ["Monzo", "60018237", "04-00-04"], reportsTo: "priya", seat: null, personal: "dan.price@gmail.com", mobile: "07700 901890", city: "London E3", billable: 0.84, exit: { resignation: "2026-02-27", interview: "2026-03-26", reason: "Moving to a larger studio", newWorkplace: "Pentagram" } },
  { id: "leo", first: "Leo", last: "Brennan", gender: "Male", dob: "1987-10-30", joined: "2026-01-12", dept: "growth", desig: "Growth Lead", base: 5000, paidTo: "safe", reportsTo: "maya", seat: "2026-01-12", personal: "leo.brennan@icloud.com", mobile: "07700 901996", city: "Hackney" },
  { id: "sofia", first: "Sofia", last: "Lindqvist", gender: "Female", dob: "1992-07-07", joined: "2026-02-02", dept: "engineering", desig: "Design Engineer", type: "Contract", agreement: 4800, paidTo: "safe", reportsTo: "tom", seat: null, personal: "sofia@lindqvist.se", mobile: "+46 70 123 45 67", city: "Stockholm", billable: 0.85, abroad: "Sweden" },
  { id: "nadia", first: "Nadia", last: "Farouk", gender: "Female", dob: "1989-05-19", joined: "2026-03-03", dept: "operations", desig: "Office and Finance Manager", base: 4300, paidTo: "bank", bank: ["Santander", "40917726", "09-01-29"], reportsTo: "maya", seat: "2026-03-03", personal: "nadia.farouk@gmail.com", mobile: "07700 902012", city: "Ilford" },
  { id: "tomas", first: "Tomás", last: "Reyes", gender: "Male", dob: "1995-03-03", joined: "2026-04-07", dept: "engineering", desig: "Software Engineer", base: 3700, paidTo: "bank", bank: ["Monzo", "82290164", "04-00-04"], reportsTo: "tom", seat: null, personal: "tomas.reyes@gmail.com", mobile: "07700 902118", city: "London SE8", billable: 0.85 },
  { id: "meilin", first: "Mei Lin", last: "Zhou", gender: "Female", dob: "1996-11-25", joined: "2026-05-05", dept: "design", desig: "Product Designer", base: 3500, paidTo: "bank", bank: ["HSBC", "71834402", "40-03-15"], reportsTo: "priya", seat: null, personal: "meilin.zhou@gmail.com", mobile: "07700 902224", city: "London E14", billable: 0.84 },
  { id: "callum", first: "Callum", last: "Burke", gender: "Male", dob: "1990-08-08", joined: "2026-06-01", dept: "engineering", desig: "Senior Software Engineer", base: 4400, paidTo: "safe", reportsTo: "tom", seat: "2026-11-03", personal: "callum.burke@proton.me", mobile: "07700 902330", city: "Brockley", billable: 0.85 },
  { id: "zara", first: "Zara", last: "Ahmed", gender: "Female", dob: "1993-02-14", joined: "2026-07-06", dept: "growth", desig: "Account Manager", base: 3800, paidTo: "bank", bank: ["Nationwide", "19302847", "07-04-36"], reportsTo: "leo", seat: null, personal: "zara.ahmed@outlook.com", mobile: "07700 902436", city: "Stratford" },
  { id: "hannah", first: "Hannah", last: "Cole", gender: "Female", dob: "2001-06-30", joined: "2026-10-12", dept: "design", desig: "Junior Designer", base: 2800, paidTo: "safe", reportsTo: "priya", seat: null, personal: "hannah.cole@gmail.com", mobile: "07700 902542", city: "London N17", billable: 0.8, noAccountUntil: "2026-11-04" },
];

// People who are not employees but appear: a Director, guests, investors' people, an invitee.
export const OTHERS = [
  { id: "ruth", first: "Ruth", last: "Calloway", email: "ruth@northbank.vc", role: "Partner, Northbank Ventures", seat: "2026-08-20" },
  { id: "samh", first: "Sam", last: "Hollis", email: "sam@hollisreed.co.uk", role: "Accountant, Hollis & Reed" },
  { id: "jo", first: "Jo", last: "Bates", email: "jo.bates@aldermoorhousing.org", role: "Head of Digital, Aldermoor Housing Trust" },
  { id: "alice", first: "Alice", last: "Penrose", email: "alice@penroselegal.co.uk", role: "Partner, Penrose Legal LLP" },
  { id: "owen", first: "Owen", last: "Grady", email: "owen.grady@gmail.com", role: "Senior Software Engineer (joins 4 Jan 2027)" },
];

export const DEPARTMENTS = [
  { id: "harbourline", name: "Harbourline", parent: null, costCenter: "Main", holders: [{ who: "maya", from: "2025-05-01" }] },
  { id: "design", name: "Design", parent: "harbourline", costCenter: "Design", holders: [{ who: "maya", from: "2025-05-01", to: "2025-05-12" }, { who: "priya", from: "2025-05-12" }] },
  { id: "engineering", name: "Engineering", parent: "harbourline", costCenter: "Engineering", holders: [{ who: "tom", from: "2025-05-01" }, { who: "@tom-build", from: "2026-02-02" }] },
  { id: "delivery", name: "Delivery", parent: "harbourline", costCenter: "Delivery", holders: [{ who: "isla", from: "2025-05-01", to: "2025-10-06" }, { who: "grace", from: "2025-10-06" }] },
  { id: "growth", name: "Growth", parent: "harbourline", costCenter: "Growth", holders: [{ who: "maya", from: "2025-05-01", to: "2026-01-19" }, { who: "leo", from: "2026-01-19" }] },
  { id: "operations", name: "Operations", parent: "harbourline", costCenter: "Operations", holders: [{ who: "maya", from: "2025-05-01", to: "2026-03-03" }, { who: "nadia", from: "2026-03-03" }] },
];

export const ALLOWANCES = [
  { id: "subscriptions", name: "Subscriptions", parent: "operations", monthly: 1200, holders: [{ who: "@kwame-ops", from: "2025-07-01" }], purpose: "Software the studio pays for in USDC" },
  { id: "capxul", name: "Capxul", parent: "operations", monthly: 200, holders: [{ who: "kwame", from: "2025-07-01" }], purpose: "Capxul's own charges: seats and the FDE's hosting" },
  { id: "travel", name: "Travel", parent: "delivery", monthly: 2000, holders: [{ who: "grace", from: "2025-10-13" }], purpose: "Client travel booked by the Delivery Lead" },
];

// Officer hats (no money): who wore each, and when.
export const OFFICER_HATS = {
  people: [{ who: "samw", from: "2025-05-01" }, { who: "kwame", from: "2025-06-02" }, { who: "isla", from: "2025-10-06" }],
  books: [{ who: "maya", from: "2025-05-01", to: "2025-06-02" }, { who: "kwame", from: "2025-06-02" }],
  invoicing: [{ who: "maya", from: "2025-05-01" }, { who: "kwame", from: "2025-06-02" }, { who: "leo", from: "2026-01-19" }],
};

export const DIRECTORS = [
  { who: "maya", from: "2025-05-01", signs: true, seatClass: "Founder", electedBy: "Founder (on setup); re-elected by vote vt_0003", termEnds: "2028-08-20" },
  { who: "tom", from: "2025-09-01", signs: true, seatClass: "Common", electedBy: "Seated by Maya Okafor; re-elected by vote vt_0003", termEnds: "2028-08-20" },
  { who: "ruth", from: "2026-08-20", signs: true, seatClass: "Seed Preferred", electedBy: "Shareholder vote vt_0003", termEnds: "2028-08-20" },
];

export const AGENTS = [
  { handle: "@kwame-ops", name: "Ops helper", owner: "kwame", created: "2025-07-01", state: "Active", hats: ["Subscriptions allowance"] },
  { handle: "@priya-studio", name: "Studio assistant", owner: "priya", created: "2025-09-04", state: "Active", hats: [] },
  { handle: "@grace-pm", name: "Delivery assistant", owner: "grace", created: "2025-11-10", state: "Active", hats: [] },
  { handle: "@leo-outreach", name: "Outreach", owner: "leo", created: "2026-01-20", state: "Frozen", frozenAt: "2026-10-30", hats: [] },
  { handle: "@tom-build", name: "Build bot", owner: "tom", created: "2026-02-02", state: "Active", hats: ["Engineering (with Tom Ashworth)"] },
  { handle: "@maya-desk", name: "Desk", owner: "maya", created: "2026-04-14", state: "Active", hats: [] },
];

// Customers. channel: how they pay. bridge = bank transfer to Harbourline's Bridge bank details (becomes USDC);
// barclays = to the ordinary bank account; capxul = from their own Safe; link = through a request's pay link.
export const CUSTOMERS = [
  { id: "fernhill", name: "Fernhill Energy Ltd", short: "Fernhill Energy", industry: "Energy", territory: "United Kingdom", city: "Leeds", website: "fernhillenergy.co.uk", vat: "GB 298 1174 33", currency: "GBP", terms: 30, payDays: [24, 34], channel: "barclays", switchToBridge: "2026-01-01", employees: "201-500", revenue: 61000000, desc: "Community energy supplier with 140,000 customers in the North", opening: true },
  { id: "aldermoor", name: "Aldermoor Housing Trust", short: "Aldermoor Housing", industry: "Real Estate", territory: "United Kingdom", city: "Reading", website: "aldermoorhousing.org", vat: "GB 318 4471 20", currency: "GBP", terms: 30, payDays: [38, 58], channel: "bridge", partial: 0.3, employees: "501-1000", revenue: 92000000, desc: "Housing association with 11,000 homes across Berkshire and Oxfordshire" },
  { id: "calder", name: "Calder & Finch Architects", short: "Calder & Finch", industry: "Architecture", territory: "United Kingdom", city: "Manchester", website: "calderfinch.co.uk", vat: "GB 772 0918 54", currency: "GBP", terms: 30, payDays: [45, 80], channel: "barclays", partial: 0.6, employees: "51-200", revenue: 14000000, desc: "Architecture practice, 80 people, Manchester and Glasgow" },
  { id: "copperleaf", name: "Copperleaf Studios ApS", short: "Copperleaf Studios", industry: "Advertising", territory: "Denmark", city: "Copenhagen", website: "copperleaf.dk", vat: "DK 41 88 20 17", currency: "GBP", terms: 21, payDays: [12, 22], channel: "link", reverseCharge: true, employees: "11-50", revenue: 5200000, desc: "Brand and advertising studio in Copenhagen" },
  { id: "northstar", name: "Northstar Retail Ltd", short: "Northstar Retail", industry: "Retail", territory: "United Kingdom", city: "Birmingham", website: "northstarretail.co.uk", vat: "GB 655 3092 81", currency: "GBP", terms: 30, payDays: [26, 33], channel: "bridge", employees: "1001-5000", revenue: 240000000, desc: "Homeware retailer, 64 stores and online" },
  { id: "osprey", name: "Osprey Health Partnership", short: "Osprey Health", industry: "Health Care", territory: "United Kingdom", city: "Bristol", website: "ospreyhealth.org.uk", vat: "GB 284 6610 09", currency: "GBP", terms: 30, payDays: [40, 70], channel: "bridge", partial: 0.5, employees: "201-500", revenue: 33000000, desc: "Partnership of 18 GP practices in the South West" },
  { id: "larkspur", name: "Larkspur Coffee Co.", short: "Larkspur Coffee", industry: "Food", territory: "United Kingdom", city: "London", website: "larkspurcoffee.co.uk", vat: "GB 593 0274 46", currency: "GBP", terms: 30, payDays: [20, 28], channel: "bridge", employees: "201-500", revenue: 18500000, desc: "14 coffee shops in London and Bristol" },
  { id: "meridian", name: "Meridian Labs Inc.", short: "Meridian Labs", industry: "Software", territory: "United States", city: "Boston", website: "meridianlabs.io", vat: "", currency: "USD", terms: 15, payDays: [9, 15], channel: "capxul", handle: "@meridianlabs", reverseCharge: true, employees: "51-200", revenue: 21000000, desc: "Developer tools for clinical data teams" },
  { id: "saltmarsh", name: "Saltmarsh Distillery Ltd", short: "Saltmarsh Distillery", industry: "Food", territory: "United Kingdom", city: "Whitstable", website: "saltmarshdistillery.co.uk", vat: "GB 361 5528 70", currency: "GBP", terms: 14, payDays: [10, 14], channel: "bridge", employees: "11-50", revenue: 3800000, desc: "Gin and whisky distillery on the Kent coast" },
  // small fixed-fee engagements
  { id: "wexford", name: "Wexford Museums Trust", short: "Wexford Museums", industry: "Non Profit", territory: "United Kingdom", city: "Canterbury", website: "wexfordmuseums.org.uk", vat: "GB 440 1937 22", currency: "GBP", terms: 30, payDays: [28, 36], channel: "barclays", employees: "201-500", revenue: 9000000, desc: "Charitable trust running four museums in the south-east" },
  { id: "hollowoak", name: "Hollow Oak Brewing Co.", short: "Hollow Oak Brewing", industry: "Food", territory: "United Kingdom", city: "Sheffield", website: "hollowoak.beer", vat: "GB 517 8823 09", currency: "GBP", terms: 14, payDays: [12, 18], channel: "bridge", employees: "11-50", revenue: 2600000, desc: "Craft brewery and three taprooms" },
  { id: "ferryman", name: "Ferryman Logistics Ltd", short: "Ferryman Logistics", industry: "Transportation", territory: "United Kingdom", city: "Southampton", website: "ferrymanlogistics.co.uk", vat: "GB 702 4461 38", currency: "GBP", terms: 30, payDays: [29, 31], channel: "bridge", employees: "501-1000", revenue: 74000000, desc: "Port logistics and freight forwarding" },
  { id: "mosaic", name: "Mosaic Learning Ltd", short: "Mosaic Learning", industry: "Education", territory: "United Kingdom", city: "London", website: "mosaiclearning.co.uk", vat: "GB 610 2290 15", currency: "GBP", terms: 30, payDays: [22, 30], channel: "bridge", employees: "51-200", revenue: 7400000, desc: "Online tutoring for GCSE and A-level students" },
  { id: "pennant", name: "Pennant Rail Ltd", short: "Pennant Rail", industry: "Transportation", territory: "United Kingdom", city: "York", website: "pennantrail.co.uk", vat: "GB 883 0175 62", currency: "GBP", terms: 30, payDays: [30, 44], channel: "bridge", employees: "1001-5000", revenue: 310000000, desc: "Regional rail operator in the North East" },
  { id: "thistle", name: "Thistle & Rowan Ltd", short: "Thistle & Rowan", industry: "Retail", territory: "United Kingdom", city: "Edinburgh", website: "thistleandrowan.co.uk", vat: "GB 925 7713 40", currency: "GBP", terms: 30, payDays: [18, 26], channel: "bridge", employees: "11-50", revenue: 4100000, desc: "Scottish knitwear brand selling online and in two shops" },
  { id: "kinfolk", name: "Kinfolk Health Ltd", short: "Kinfolk Health", industry: "Health Care", territory: "United Kingdom", city: "Cardiff", website: "kinfolkhealth.co.uk", vat: "GB 480 3361 77", currency: "GBP", terms: 30, payDays: [25, 33], channel: "bridge", employees: "51-200", revenue: 8800000, desc: "Home care provider across South Wales" },
  { id: "bellwether", name: "Bellwether Labs Inc.", short: "Bellwether Labs", industry: "Software", territory: "United States", city: "Austin", website: "bellwetherlabs.com", vat: "", currency: "USD", terms: 30, payDays: [6, 9], channel: "capxul", handle: "@bellwether", reverseCharge: true, employees: "11-50", revenue: 6000000, desc: "Product analytics for hardware start-ups" },
];

// Suppliers. pay: how Harbourline pays them.
export const SUPPLIERS = [
  { id: "brightfield", name: "Brightfield Workspace Ltd", group: "Services", country: "United Kingdom", vat: "GB 377 2019 84", currency: "GBP", pay: "payout", bank: ["NatWest", "2291", "60-15-31"], from: "operations", email: "accounts@brightfieldworkspace.co.uk" },
  { id: "kestrel", name: "Kestrel Cloud Ltd", group: "Services", country: "United Kingdom", vat: "GB 815 0042 19", currency: "GBP", pay: "usdc", handle: "@kestrelcloud", from: "engineering", email: "billing@kestrelcloud.co.uk" },
  { id: "marta", name: "Marta Kowalczyk", group: "Contractors", country: "Poland", vat: "", currency: "USD", pay: "usdc", handle: "@marta-k", from: "engineering", email: "marta.kowalczyk@pm.me", noAccountUntil: "2026-02-06" },
  { id: "varga", name: "Studio Varga", group: "Contractors", country: "Hungary", vat: "", currency: "USD", pay: "usdc", handle: "@studiovarga", from: "design", email: "hello@studiovarga.hu" },
  { id: "hollis", name: "Hollis & Reed Accountants", group: "Services", country: "United Kingdom", vat: "GB 239 8841 05", currency: "GBP", pay: "payout", bank: ["Lloyds", "8804", "30-99-50"], from: "operations", email: "sam@hollisreed.co.uk" },
  { id: "penrose", name: "Penrose Legal LLP", group: "Services", country: "United Kingdom", vat: "GB 190 5527 31", currency: "GBP", pay: "barclays", from: "operations", email: "billing@penroselegal.co.uk" },
  { id: "tallis", name: "Tallis Insurance Brokers", group: "Services", country: "United Kingdom", vat: "", currency: "GBP", pay: "payout", bank: ["Barclays", "6612", "20-00-00"], from: "operations", email: "renewals@tallisbrokers.co.uk" },
  { id: "jigsaw", name: "Jigsaw Systems Ltd", group: "Hardware", country: "United Kingdom", vat: "GB 448 2031 66", currency: "GBP", pay: "payout", bank: ["HSBC", "3307", "40-05-30"], from: "operations", email: "orders@jigsawsystems.co.uk" },
  { id: "fieldwork", name: "Fieldwork Catering Ltd", group: "Services", country: "United Kingdom", vat: "GB 702 9915 40", currency: "GBP", pay: "payout", bank: ["Starling", "0932", "60-83-71"], from: "operations", email: "events@fieldworkcatering.co.uk" },
  { id: "canvasly", name: "Canvasly Inc.", group: "Software", country: "United States", vat: "", currency: "USD", pay: "usdc", handle: "@canvasly", from: "subscriptions", email: "billing@canvasly.app" },
  { id: "tracklane", name: "Tracklane Inc.", group: "Software", country: "United States", vat: "", currency: "USD", pay: "usdc", handle: "@tracklane", from: "subscriptions", email: "billing@tracklane.dev" },
  { id: "gitforge", name: "Gitforge Ltd", group: "Software", country: "Ireland", vat: "", currency: "USD", pay: "usdc", handle: "@gitforge", from: "subscriptions", email: "billing@gitforge.io" },
  { id: "capxul", name: "Capxul", group: "Software", country: "United Kingdom", vat: "", currency: "USD", pay: "usdc", handle: "@capxul", from: "capxul", email: "billing@capxul.com" },
  { id: "hmrc", name: "HM Revenue and Customs", group: "Government", country: "United Kingdom", vat: "", currency: "GBP", pay: "barclays", from: null, email: "" },
  { id: "nest", name: "Nest Pensions", group: "Pensions", country: "United Kingdom", vat: "", currency: "GBP", pay: "barclays", from: null, email: "" },
  { id: "pryce", name: "Ian Pryce", group: "Contractors", country: "United Kingdom", vat: "", currency: "GBP", pay: "usdc", email: "ian.pryce@outlook.com", from: "growth", noAccount: true },
  { id: "marchetti", name: "Jules Marchetti", group: "Contractors", country: "France", vat: "", currency: "USD", pay: "usdc", email: "jules.marchetti@proton.me", from: "design", noAccount: true },
  { id: "osei", name: "Mike Osei", group: "Contractors", country: "United Kingdom", vat: "", currency: "USD", pay: "usdc", email: "m.osei@gmail.com", from: "growth", noAccountUntil: "2026-07-17" },
  { id: "northbank", name: "Northbank Ventures LLP", group: "Investors", country: "United Kingdom", vat: "", currency: "USD", pay: "usdc", handle: "@northbank", from: "board", email: "ops@northbank.vc" },
  { id: "stayway", name: "Stayway Travel Ltd", group: "Travel", country: "United Kingdom", vat: "", currency: "GBP", pay: "usdc", handle: "@stayway", from: "travel", email: "bookings@stayway.travel" },
  { id: "fieldnotes", name: "Fieldnotes Research Ltd", group: "Services", country: "United Kingdom", vat: "GB 571 0388 92", currency: "GBP", pay: "usdc", handle: "@fieldnotes", from: "design", email: "studies@fieldnotes.co.uk" },
  { id: "commonroom", name: "Commonroom Venues Ltd", group: "Services", country: "United Kingdom", vat: "GB 640 2217 15", currency: "GBP", pay: "payout", bank: ["Metro Bank", "5518", "23-05-80"], from: "delivery", email: "hire@commonroom.london" },
  { id: "pitchside", name: "Pitchside Events Ltd", group: "Services", country: "United Kingdom", vat: "GB 337 9015 48", currency: "GBP", pay: "payout", bank: ["Lloyds", "7740", "30-96-26"], from: "growth", email: "exhibitors@pitchside.events" },
  { id: "brightline", name: "Brightline Media Ltd", group: "Services", country: "United Kingdom", vat: "GB 802 6643 11", currency: "GBP", pay: "usdc", handle: "@brightlinemedia", from: "growth", email: "ads@brightline.media" },
  { id: "quillmail", name: "Quillmail Workspace", group: "Software", country: "Ireland", vat: "", currency: "GBP", pay: "card", from: null, email: "" },
  { id: "palette", name: "Palette Pro", group: "Software", country: "Ireland", vat: "", currency: "GBP", pay: "card", from: null, email: "" },
  { id: "relay", name: "Relay Chat Ltd", group: "Software", country: "United Kingdom", vat: "", currency: "GBP", pay: "card", from: null, email: "" },
];

// Projects. billing: tm (time and materials, invoiced monthly in arrears), retainer (fixed monthly in advance), none.
export const PROJECTS = [
  { id: "PROJ-0001", name: "Fernhill field app", customer: "fernhill", type: "External", dept: "delivery", start: "2025-03-03", end: "2025-08-29", billing: "tm", priority: "High", estimatedCost: 82000, team: { ellis: 0.6, jamal: 0.8, amira: 0.6, isla: 0.5, oliver: 0.7, freya: 0.3 }, notes: "Field engineers' app for meter installs. Weekly invoicing moved to monthly from May." },
  { id: "PROJ-0002", scale: 0.75, name: "Aldermoor tenant portal", customer: "aldermoor", type: "External", dept: "engineering", start: "2025-05-06", end: "2025-12-19", billing: "tm", priority: "High", estimatedCost: 128000, team: { ben: 0.8, josh: 0.7, lena: 0.5, chloe: 0.5, oliver: 0.3, ravi: 0.5, ellis: 0.3, tom: 0.25, priya: 0.2 } },
  { id: "PROJ-0003", scale: 0.55, name: "Copperleaf brand identity", customer: "copperleaf", type: "External", dept: "design", start: "2025-09-15", end: "2026-02-13", billing: "tm", priority: "Medium", estimatedCost: 41000, team: { freya: 0.7, amira: 0.5, priya: 0.4, lena: 0.3 } },
  { id: "PROJ-0004", scale: 0.6, name: "Calder & Finch site and booking", customer: "calder", type: "External", dept: "design", start: "2025-07-07", end: "2025-11-28", billing: "tm", priority: "Medium", estimatedCost: 52000, team: { lena: 0.5, chloe: 0.4, ellis: 0.4, jamal: 0.2, freya: 0.4, priya: 0.25 } },
  { id: "PROJ-0005", scale: 0.9, name: "Fernhill app v2", customer: "fernhill", type: "External", dept: "delivery", start: "2026-01-12", end: "2026-06-30", billing: "tm", priority: "High", estimatedCost: 118000, team: { ellis: 0.7, jamal: 0.8, josh: 0.5, amira: 0.6, daniel: 0.6, grace: 0.3, ravi: 0.4, tom: 0.2, freya: 0.3 } },
  { id: "PROJ-0006", scale: 0.85, name: "Northstar Retail replatform", customer: "northstar", type: "External", dept: "engineering", start: "2025-10-06", end: "2026-04-24", billing: "tm", priority: "High", estimatedCost: 146000, team: { ben: 0.8, josh: 0.5, ellis: 0.3, lena: 0.5, chloe: 0.4, daniel: 0.3, isla: 0.4, sofia: 0.6, tom: 0.3 } },
  { id: "PROJ-0007", name: "Osprey Health appointment booking", customer: "osprey", type: "External", dept: "delivery", start: "2026-03-02", end: "2026-07-31", billing: "tm", priority: "Medium", estimatedCost: 74000, team: { tomas: 0.7, chloe: 0.5, ben: 0.3, meilin: 0.6, isla: 0.4, freya: 0.3, ravi: 0.3 } },
  { id: "PROJ-0008", name: "Harbourline website refresh", customer: null, type: "Internal", dept: "growth", start: "2026-02-02", end: "2026-05-29", billing: "none", priority: "Low", estimatedCost: 18000, hold: "2026-05-15", team: { freya: 0.15, amira: 0.1 } },
  { id: "PROJ-0009", name: "Aldermoor support retainer", customer: "aldermoor", type: "External", dept: "engineering", start: "2026-01-05", end: "2026-12-31", billing: "retainer", retainer: 4500, priority: "Medium", estimatedCost: 36000, team: { ben: 0.2, ravi: 0.15 } },
  { id: "PROJ-0010", name: "Saltmarsh online shop", customer: "saltmarsh", type: "External", dept: "design", start: "2026-11-02", end: "2027-02-26", billing: "fixed", fee: 38000, priority: "Medium", estimatedCost: 26000, team: { freya: 0.4, meilin: 0.3, hannah: 0.3 } },
  { id: "PROJ-0011", scale: 0.6, name: "Larkspur ordering app", customer: "larkspur", type: "External", dept: "delivery", start: "2026-04-06", end: "2027-01-29", billing: "tm", priority: "High", estimatedCost: 124000, team: { ellis: 0.7, jamal: 0.7, lena: 0.6, tomas: 0.3, callum: 0.5, grace: 0.3, priya: 0.2, hannah: 0.3, ravi: 0.5, isla: 0.3, sofia: 0.3, tom: 0.2 } },
  { id: "PROJ-0012", scale: 0.55, name: "Meridian design system", customer: "meridian", type: "External", dept: "design", start: "2026-05-18", end: "2026-12-18", billing: "tm", priority: "High", estimatedCost: 88000, team: { amira: 0.6, chloe: 0.4, meilin: 0.5, sofia: 0.3, josh: 0.3, priya: 0.25, hannah: 0.3, freya: 0.3, isla: 0.2 } },
  { id: "PROJ-0013", name: "Studio tooling and templates", customer: null, type: "Other", dept: "engineering", start: "2026-08-03", end: "2026-12-18", billing: "none", priority: "Medium", estimatedCost: 30000, team: { tom: 0.25, josh: 0.3, ben: 0.5, callum: 0.25, tomas: 0.3 } },
];

// The second retainer: Northstar's care plan after the replatform.
export const RETAINERS = [
  { id: "northstar-care", customer: "northstar", project: "PROJ-0006", name: "Northstar care plan", start: "2026-05-01", monthly: 2000 },
];

// One-off fixed-fee engagements (won deals with no project): invoiced on delivery.
export const FIXED_FEES = [
  { customer: "wexford", date: "2025-07-31", item: "Accessibility audit: four museum websites", amount: 6800, account: "4100", cc: "Design" },
  { customer: "hollowoak", date: "2025-09-26", item: "Brand refresh workshop and toolkit", amount: 4200, account: "4100", cc: "Design" },
  { customer: "ferryman", date: "2025-11-21", item: "Driver app audit and recommendations", amount: 7200, account: "4000", cc: "Engineering" },
  { customer: "aldermoor", date: "2025-12-12", item: "Phase 2 discovery sprint: repairs reporting", amount: 9600, account: "4100", cc: "Design" },
  { customer: "mosaic", date: "2026-02-27", item: "Five-day design sprint: tutor matching", amount: 8800, account: "4100", cc: "Design" },
  { customer: "pennant", date: "2026-03-27", item: "Discovery sprint: passenger assistance booking", amount: 12500, account: "4000", cc: "Engineering" },
  { customer: "thistle", date: "2026-06-26", item: "Clickable prototype: made-to-measure ordering", amount: 9600, account: "4100", cc: "Design" },
  { customer: "kinfolk", date: "2026-08-28", item: "UX review of the carer rota app", amount: 5400, account: "4100", cc: "Design" },
  { customer: "bellwether", date: "2026-10-16", item: "Design review: device setup flow", amount: 12000, account: "4100", cc: "Design" },
];

export const BANK = {
  barclays: { name: "Barclays Business · GBP", bank: "Barclays", sortCode: "20-45-77", accountNo: "83124417", last4: "4417", iban: "GB29 BARC 2045 7783 1244 17", account: "1050" },
};

// GBP per USD (1 USDC = 1 USD) on the first of each month; the generator interpolates and adds a little daily noise.
export const RATE_ANCHORS = [
  ["2025-03-01", 0.7915], ["2025-04-01", 0.7738], ["2025-05-01", 0.7518], ["2025-06-01", 0.7392], ["2025-07-01", 0.7301],
  ["2025-08-01", 0.7436], ["2025-09-01", 0.7412], ["2025-10-01", 0.7448], ["2025-11-01", 0.7611], ["2025-12-01", 0.7483],
  ["2026-01-01", 0.743], ["2026-02-01", 0.735], ["2026-03-01", 0.742], ["2026-04-01", 0.756], ["2026-05-01", 0.7495],
  ["2026-06-01", 0.738], ["2026-07-01", 0.731], ["2026-08-01", 0.759], ["2026-09-01", 0.772], ["2026-10-01", 0.781],
  ["2026-11-01", 0.788], ["2026-11-09", 0.7893], ["2026-12-31", 0.79],
];
