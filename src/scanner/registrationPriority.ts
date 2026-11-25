/** Evidence-gated fallback order. Only positively identified ALL FOUR
 * unique ArUco markers justify trying that independently verifiable warp
 * before generic midpoint hypotheses. Other rescue families remain available.
 */
export type FallbackKind='corner'|'midpoint'|'aruco'|'hybrid';
export type FallbackCandidate={kind:FallbackKind;name:string};
export function orderFallbackCandidates<T extends FallbackCandidate>(
  candidates:readonly T[], evidence:{cornerFailed:boolean;arucoCount:number;arucoFound:boolean}
):{candidates:T[];strategy:string}{
  if(!evidence.cornerFailed||!evidence.arucoFound||evidence.arucoCount!==4)
    return {candidates:[...candidates],strategy:'original-order; ArUco identity evidence insufficient'};
  const priority=(c:T):number=>
    c.name==='aruco/adaptive'?0:
    c.name==='midpoint/aruco-guided'?1:
    c.name==='midpoint/adaptive'?2:3;
  return {candidates:candidates.map((c,i)=>({c,i}))
    .sort((a,b)=>priority(a.c)-priority(b.c)||a.i-b.i)
    .map(x=>x.c),
    strategy:'4 independently identified ArUco IDs: verify ArUco first; QR/50 timing still mandatory'};
}
