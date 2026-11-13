export type ApprovalState = "sponsoring" | "pending" | "signed" | "sending" | "sent" | "landed" | "reverted" | "displaced" | "expired" | "declined" | "refused" | "withdrawn";
export type ApprovalView = {
  approvalId: string; url: string; state: ApprovalState;
  opener: "accounts" | "organizations" | "board" | "agents" | "budgets" | "payments" | "payroll" | "equity";
  subjectKind: string; subjectId: string; orgId: string | null;
  summary: {
    title: string; from: { label: string; address: string }; to: { label: string }; amount: { asset: string; value: string } | null;
    recipients: { label: string; amount: { asset: string; value: string }; requestedOutput: { currency: string; value: string } | null;
      exact: boolean; rail: "wallet" | "bank"; warning: { code: string; message: string } | null }[];
    warnings: { code: string; message: string }[];
  };
  network: { chainId: number; name: string; explorerUrl: string }; sender: string;
  calls: { to: string; value: string; data: string }[]; signer: { address: string } | null;
  nonceKey: string; deadline: string; replacement: { approvalId: string; nonce: string } | null;
  operation: {
    userOperation: { sender: string; nonce: string; callData: string; callGasLimit: string; verificationGasLimit: string;
      preVerificationGas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; paymaster: string;
      paymasterVerificationGasLimit: string; paymasterPostOpGasLimit: string; paymasterData: string };
    digest: string; userOpHash: string; validAfter: string | null; validUntil: string;
  } | null;
  sendAfter: string | null; expiresAt: string; refusal: { code: string; reason: string } | null;
  sendError: { code: string; reason: string } | null; transactionHash: string | null; displacedBy: string | null;
  createdAt: string; reviewedAt: string | null; signedAt: string | null; sentAt: string | null; endedAt: string | null;
};
export type ApprovalCall = { traceId: string; callId: string; signal?: AbortSignal };
