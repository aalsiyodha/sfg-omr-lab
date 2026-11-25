/** Fast-path only for independently QR-verified, near-perfect two-sided registration.
 * 48/50 with at least 23 on each side avoids redundant costly warps.
 * A merely passing 35/50 candidate is NOT sufficient to end the search.
 */
export function canStopRegistrationSearch(qrVerified:boolean,timingMatched:number,
  leftMatched:number,rightMatched:number):boolean{
  return qrVerified && timingMatched>=48 && timingMatched<=50 &&
    leftMatched>=23 && rightMatched>=23 &&
    leftMatched<=25 && rightMatched<=25 &&
    leftMatched+rightMatched===timingMatched;
}
