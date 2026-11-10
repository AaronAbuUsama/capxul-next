## What
Build the six tests of decision devnet.time-is-right: (1) the scan that fails the build when a pinned app adds an unlabelled direct read of the machine's clock, with the committed list of the direct reads; (2) a month end where every ledger date equals the world's date; (3) a jump across a fiscal year with the next year created first; (4) a restore to an earlier snapshot with job counts; (5) two worlds at different times on one bench, also under load from one worker; (6) a person's session across an advance. Add the gaps beside them: past-world log retention, every scheduled job once per period across a 60-day jump, an upgrade rehearsal. Make the direct reads that decide something point at the world's clock, switch log clean-up off in worlds, and propose the seam to Frappe upstream.
## Why
Aaron settled devnet.site-follows-world for option A on 10 November 2026 and said the time has to be right. A mistake shows up as a document dated by the machine, often unnoticed until a month end, so each proof is a run. Only two of six tests exist in the spike.
## Done when
- The scan exists, is in the checks and fails on an unlabelled direct read; the committed list labels every direct read.
- The month-end, fiscal-year, restore and two-world tests run and pass, each as an eval of the book, on a bench with the clock seam; the restore test counts jobs.
- The session rule (a one-day step keeps a signed-in session, a step past its lifetime ends it with a message) is a passing test.
- The coordinator's re-run of the clock checks has passed.
