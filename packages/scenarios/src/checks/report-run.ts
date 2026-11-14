// The checks of every report.run (claims.md, report.run 2 and 3, record.export 2): a report answers the report asked
// and makes nothing; a caller with no user on the site, and a report the site will not open, are refused, naming why.
import { same } from "../support/expect.ts";
import { namesCaller, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks } from "./format.ts";

export const reportRun = checks<"report.run", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, answered, before) => [
    check("it answers the report asked", same("the report", answered.report, asked.payload.report)),
    nothingRecorded("a report", before),
  ],
  refusals: {
    NoSiteUser: (asked, refused, before) => [
      check("NoSiteUser names the company asked", same("its org", refused.org, asked.payload.org)),
      namesCaller("NoSiteUser", refused.person, asked.options),
      nothingRecorded("the refused report", before),
    ],
    SiteRefused: (asked, refused, before) => [
      check(
        "SiteRefused names the company and the report asked",
        same("SiteRefused", [refused.org, refused.target], [asked.payload.org, asked.payload.report]),
      ),
      nothingRecorded("the refused report", before),
    ],
    OrgNotFound: (asked, refused, before) => [
      check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
      nothingRecorded("the refused report", before),
    ],
  },
});
