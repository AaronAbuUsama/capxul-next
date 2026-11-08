// The accounts area: the beta welcome when a mailbox is admitted, and the account-ready message when
// a person's own Safe is set up. Both follow accounts' transitions through the outbox; accounts sends
// no mail (accounts.door, accounts.admission-paths). An admission that an Organization's invitation
// carried sends no welcome: the invitation email is the welcome (procedures.accounts-admit). The old
// "you're on the list" email is not ported with the hold that sent it (accounts.admission-paths).

import { table_principals } from "../access/data.ts";
import { machine_personal_safe, machine_waitlist_entry, table_admissions, table_personal_safes } from "../accounts/data.ts";
import { table_parties } from "../parties/data.ts";
import { noticeWorkflow } from "./kit.ts";

const OLD = "packages/backend/src";
const W = `${OLD}/access/waitlist`;

const e = machine_waitlist_entry.t;

const WELCOME_STEPS = [
  {
    name: "admission",
    about:
      "Reads the admission: its mailbox and who admitted it. One admitted `invitation:<org>` stops here with no notice; " +
      "`operator`, `referral` and `reward` go on.",
  },
  {
    name: "facts",
    about:
      "The deployment's quickstart, chat and support links, and for a referral the referrer's name: their principal by " +
      "email, then the name on their Party, else their mailbox.",
  },
] as const;

const WELCOME_ABOUT =
  "Sends `beta-welcome` to the admitted mailbox. A referrer's invite (`referral invite`) is this welcome, naming who " +
  "invited them; an operator's admission and a waiting referrer's reward send it without a name. An admission an " +
  "Organization's invitation carried sends nothing (its invitation email is the welcome, and `org member invite` " +
  "admits 'with no second welcome email'). A referral rewarded with an invite sends nothing, as before.";

export const workflow_notices_accounts_welcome = noticeWorkflow({
  id: "notices.accounts.welcome",
  title: "Welcome a waiting mailbox admitted to the beta",
  about: `Follows \`admit\`: a mailbox on the waitlist is admitted. ${WELCOME_ABOUT}`,
  trigger: { transition: e.admit },
  reads: [table_admissions, table_principals, table_parties],
  steps: WELCOME_STEPS,
  was: [`${W}/writes.ts:121`, `${W}/operations/deliver-welcome.ts:21`, `${W}/operations/admit.ts:51`, `${W}/external.ts:27`],
});

export const workflow_notices_accounts_welcome_unlisted = noticeWorkflow({
  id: "notices.accounts.welcome-unlisted",
  title: "Welcome a mailbox admitted before it ever joined the waitlist",
  about: `Follows \`admit_unlisted\`: a mailbox nobody put on the list is admitted at once. ${WELCOME_ABOUT}`,
  trigger: { transition: e.admit_unlisted },
  reads: [table_admissions, table_principals, table_parties],
  steps: WELCOME_STEPS,
  was: [`${OLD}/access/referrals/operations/invite.ts:57`, `${OLD}/access/referrals/operations/qualify.ts:61`, `${W}/external.ts:27`],
});

export const workflow_notices_accounts_account_ready = noticeWorkflow({
  id: "notices.accounts.account-ready",
  title: "Tell a person their account is ready",
  about:
    "Follows `finish`: a person's own Safe is claimed for their signer and the claim escrows that waited for them are " +
    "collected. Sends `account-ready` once, to the email the setup was for, with their name and their Safe. Old profiles " +
    "sent it at the first completed profile; the account is ready only once its Safe is, and the profile now comes " +
    "before the setup (accounts.profile-before-setup), so the message follows the setup's end (parties.no-process).",
  trigger: { transition: machine_personal_safe.t.finish },
  reads: [table_personal_safes, table_parties],
  steps: [
    { name: "setup", about: "Reads the finished setup: the person's email, their Safe and how many claim escrows it collected." },
    { name: "facts", about: "The person's name from their own Party (by owner), else none." },
  ],
  was: [`${OLD}/profiles/onboardings/external.ts:31`, "packages/protocol/src/templates/emails/account-created.ts:1"],
});
