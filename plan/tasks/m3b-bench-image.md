## What
Build the image the hosted bench runs: Frappe, ERPNext, Frappe HR, Frappe CRM and our app, as a production image, not the development one the test sites use. Test creating sites on it locally.
## Why
The test sites run a development server. A machine people rely on should not.
## Done when
- The image builds, a site is created on it, and the end-to-end script passes against it locally.
