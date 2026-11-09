# The Capxul mock-up: progress

A high-fidelity clickable mock-up of Capxul (ERPNext and Frappe re-skinned and invisible) for a 25-person company
running for 18 months. Made by `tools/workflows/capxul-erp-demo.js`; every step commits its outputs here, so the run
can restart in another account or session from what is committed.

| Step | State | Outputs |
|---|---|---|
| Research | done 2026-11-09 | `research/*.md`: accounting.md, hr-payroll.md, crm-projects.md,<br>capxul-native.md (`/home/user/capxul-next/demo/research/`) |
| Data | done 2026-11-09 | `data/generate.mjs` (+ `data/gen/*.mjs`), `data/validate.mjs` (23 of 23 pass),<br>`data/README.md` (the shape of the data), `app/data.json` (8.3 MB, deterministic).<br>Harbourline Studio Ltd, a design and engineering studio in Hoxton, runs on Capxul from 1 May 2025 to 9 Nov 2026 (10:45).<br>27 employees (14 at the start, 25 today), a Stockholm contractor, 6 departments with quarterly USDC budgets, 14 of 20 seats in use. |
| Shell | done 2026-11-09 | `app/index.html` (tokens, light and dark, all component styles), `app/js/core.js` (frame, router, components),<br>`app/js/README.md` (the component API), `app/js/gallery.js` (every component on real data; not loaded by the app),<br>stub `app/js/{money,governance,fde,accounting,hr,payroll,crm,projects}.js` that the module builders replace.<br>Checked in Chromium at 1280 and 400, light and dark: no console errors, no horizontal page scroll. |
| Modules | done 2026-11-09 | `app/js/{accounting,hr,payroll,crm,projects,money,governance,fde}.js`<br>29 routes, 64 routes, 37 routes, 35 routes |
| Integrate | stopped mid-way 14:55 (Aaron's feedback) | finished in feedback round A |
| Critique | not started | `critiques.md` |
| Fix | not started | |
| Final | not started | the artifact |

**Aaron's feedback, 9 Nov 2026 14:50:** no commands on the pages (they are for the AI); no agent call-outs embedded in pages (one assistant side panel instead); agents do realistic work (CRM: qualify and progress leads, log every touchpoint; routine HR admin; quiet bookkeeping), not paying bills; the FDE is about setting Capxul up and getting the most out of it. Critique, Fix and Final are replaced by `tools/workflows/erp-demo-feedback.js`, run three times (round A: frame and CRM; B: HR, payroll, FDE and Home; C: money, books, governance, projects and the final check), with a preview published after each.

To restart: run the workflow script again; each step reads what is here, verifies it, and continues from it.
