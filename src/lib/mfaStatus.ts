export interface MfaAssurance {
  currentLevel: string | null;
  nextLevel: string | null;
}

/**
 * Works out whether a user must enter their 2FA code.
 * If the factor list could not be loaded, the session's own assurance level decides,
 * so a network error can't skip the code screen.
 */
export function computeMfaStatus(aal: MfaAssurance, totpFactors: { status: string }[] | null | undefined) {
  const hasVerifiedFactor = totpFactors ? totpFactors.some((factor) => factor.status === "verified") : true;
  const enabled = aal.nextLevel === "aal2" && hasVerifiedFactor;
  return { enabled, challenged: aal.currentLevel === "aal1" && enabled };
}
