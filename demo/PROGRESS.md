# The Capxul mock-up: progress

A high-fidelity clickable mock-up of Capxul (ERPNext and Frappe re-skinned and invisible) for a 25-person company
running for 18 months. Made by `tools/workflows/capxul-erp-demo.js`; every step commits its outputs here, so the run
can restart in another account or session from what is committed.

| Step | State | Outputs |
|---|---|---|
| Research | done 2026-11-09 | `research/*.md`: accounting.md, hr-payroll.md, crm-projects.md,<br>capxul-native.md (`/home/user/capxul-next/demo/research/`) |
| Data | done 2026-11-09 | `data/generate.mjs` (+ `data/gen/*.mjs`), `data/validate.mjs` (23 of 23 pass),<br>`data/README.md` (the shape of the data), `app/data.json` (8.3 MB, deterministic).<br>Harbourline Studio Ltd, a design and engineering studio in Hoxton, runs on Capxul from 1 May 2025 to 9 Nov 2026 (10:45).<br>27 employees (14 at the start, 25 today), a Stockholm contractor, 6 departments with quarterly USDC budgets, 14 of 20 seats in use. |
| Shell | not started | `app/index.html`, `app/js/core.js`, `app/js/README.md` |
| Modules | not started | `app/js/{accounting,hr,payroll,crm,projects,money,governance,fde}.js` |
| Integrate | not started | the routes wired, the walkthroughs |
| Critique | not started | `critiques.md` |
| Fix | not started | |
| Final | not started | the artifact |

To restart: run the workflow script again; each step reads what is here, verifies it, and continues from it.
