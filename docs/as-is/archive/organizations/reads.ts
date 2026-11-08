// The as-is book of the old organizations concept: the reads area.
//
// packages/backend/src/organizations/reads/ (participation.ts, organizations.ts, proposals.ts,
// verification.ts) holds no operation: no file of it is registered under convex/organizations/, and
// no operation folder exists for it (packages/backend/src/organizations/README.md:30-33). Its
// functions are the concept's door and are booked as procedures in procedures.ts:
//
//   participation.ts   current-org-participation, require-org-participant, require-claimed-org-party,
//                      read-participating-safe-addresses-in-tx, read-contact-roster-in-tx,
//                      read-account-organization-references-in-tx, read-seat-standing-in-tx,
//                      read-seat-standing-by-email-in-tx (and `requireParticipant`, the Effect wrapper
//                      every participant-gated operation runs, which is not on the door)
//   organizations.ts   read-organization-name-in-tx, read-organization-name-by-party-in-tx,
//                      read-organization-party-id-in-tx, read-organization-safe-in-tx,
//                      read-organizations-at-safe-in-tx, read-owner-safes-in-tx,
//                      read-activity-safe-address-in-tx, read-company-deployment-in-tx,
//                      require-movement-organization-target-in-tx,
//                      require-payroll-organization-identity-in-tx,
//                      read-reconciliation-organization-page-in-tx, read-reconciliation-organization-in-tx
//   proposals.ts       read-safe-proposal-approval-subject-in-tx, read-safe-proposal-step-in-tx,
//                      read-waiting-proposal-calls-in-tx
//   verification.ts    read-verification-organization-in-tx
//
// This module re-exports them so the area is complete on its own; index.ts deduplicates records.

export {
  procedure_organizations_current_org_participation,
  procedure_organizations_read_account_organization_references_in_tx,
  procedure_organizations_read_activity_safe_address_in_tx,
  procedure_organizations_read_company_deployment_in_tx,
  procedure_organizations_read_contact_roster_in_tx,
  procedure_organizations_read_organization_name_by_party_in_tx,
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_organization_party_id_in_tx,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_organizations_read_organizations_at_safe_in_tx,
  procedure_organizations_read_owner_safes_in_tx,
  procedure_organizations_read_participating_safe_addresses_in_tx,
  procedure_organizations_read_reconciliation_organization_in_tx,
  procedure_organizations_read_reconciliation_organization_page_in_tx,
  procedure_organizations_read_safe_proposal_approval_subject_in_tx,
  procedure_organizations_read_safe_proposal_step_in_tx,
  procedure_organizations_read_seat_standing_by_email_in_tx,
  procedure_organizations_read_seat_standing_in_tx,
  procedure_organizations_read_verification_organization_in_tx,
  procedure_organizations_read_waiting_proposal_calls_in_tx,
  procedure_organizations_require_claimed_org_party,
  procedure_organizations_require_movement_organization_target_in_tx,
  procedure_organizations_require_org_participant,
  procedure_organizations_require_payroll_organization_identity_in_tx,
} from "./procedures.ts";
