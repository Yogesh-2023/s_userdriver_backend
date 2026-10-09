export const externalKycStatus = (
  status: string | null | undefined,
  onboardingStatus?: string,
  hasExpiredDocuments = false,
) => {
  if (!status) return "NOT_SUBMITTED";
  if (status === "VERIFIED" && hasExpiredDocuments) return "EXPIRED";
  if (status === "PENDING" || status === "UNDER_REVIEW") {
    return "UNDER_REVIEW";
  }
  return status === "VERIFIED" ? "APPROVED" : status;
};
