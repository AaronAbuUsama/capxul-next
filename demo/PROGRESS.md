# The Capxul mock-up: progress

A high-fidelity clickable mock-up of Capxul (ERPNext and Frappe re-skinned and invisible) for a 25-person company
running for 18 months. Made by `tools/workflows/capxul-erp-demo.js`; every step commits its outputs here, so the run
can restart in another account or session from what is committed.

| Step | State | Outputs |
|---|---|---|
| Research | done 2026-11-09 | `research/*.md`: accounting.md, hr-payroll.md, crm-projects.md,<br>capxul-native.md (`/home/user/capxul-next/demo/research/`) |
| Data | not started | `data/generate.mjs`, `data/validate.mjs`, `app/data.json` |
| Shell | not started | `app/index.html`, `app/js/core.js`, `app/js/README.md` |
| Modules | not started | `app/js/{accounting,hr,payroll,crm,projects,money,governance,fde}.js` |
| Integrate | not started | the routes wired, the walkthroughs |
| Critique | not started | `critiques.md` |
| Fix | not started | |
| Final | not started | the artifact |

To restart: run the workflow script again; each step reads what is here, verifies it, and continues from it.
