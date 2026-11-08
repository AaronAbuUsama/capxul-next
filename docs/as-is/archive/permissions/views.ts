// The as-is book of the old permissions `views` kind folder (packages/backend/src/permissions/views/)
// and the area views files beside it. It holds no records, on purpose.
//
// `views` is not an operation area: packages/backend/convex/permissions/ registers no `views` module
// (allowances, authorities, commands, configurations, grants, replacements, verifications only), the
// README's operation table lists none (README.md:265), and views/ has no operations/ folder. Its files
// are pure projections of stored rows into wire values, so, like the guards, reads, rules and writes
// folders, each function is a step of the rpcs that run it and is booked through them:
//
// views/permissions.ts
//   validatedWirePermission, toWirePermission (:144, :117)  → permissions.authorities.list,
//                                                            permissions.authorities.authorize
//   toWireAssignment (:158)                                  → permissions.authorities.list
//   commandRecipientBindings (:26)                           → the commands area's prepare and get (part two)
// views/executions.ts
//   pendingCommand (:27)                                     → permissions.commands.prepare (part two)
//   preparedPermissionExecution (:33)                        → permissions.commands.prepare-execution,
//                                                            permissions.replacements.prepare-execution (part two)
//   submittedPermissionExecution (:55)                       → permissions.commands.submit-execution (part two)
//   submittedConfiguration (:60)                             → permissions.configurations.submit-execution
// views/commands.ts
//   savedJson (:17)                                          → permissions.verifications.record (replacement apply)
//   savedPermissionValue, savedPermissionCalls (:28, :41)    → the door's prepare replay and the commands area
//   observedCommandStatus, projectCommandProof (:59, :93)    → permissions.commands.get (part two)
// views/snapshots.ts
//   assignmentAuthoritySnapshot, setupAuthoritySnapshotValidator, bootstrapPermissionConfirmationValidator
//   (:88, :31, :105): Convex validators on the door, values rather than functions (see procedures.ts);
//   receiptValidator and eventValidator (:10, :18) shape the verify actions' record arguments (model.ts:98).
// verifications/views.ts verificationResult (:15)            → permissions.verifications.verify and its workflows
// configurations/views.ts configurationIntent (:10)          → permissions.configurations.prepare-intent
// allowances/views.ts                                        → the allowances area (part two)

export {};
