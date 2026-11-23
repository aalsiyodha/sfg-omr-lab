import { version } from '../../package.json';
declare const __APP_BUILD_ID__: string;
declare const __APP_BUILD_META__: { version:string; source:'vercel'|'local-dev'|'local-build'; environment:string; sha:string; buildId:string; builtAt:string; dirty:boolean };
export const APP_VERSION = version === '2.5.0-alpha.1'
  ? 'v2.5 Alpha · Unified Optical Geometry'
  : version === '2.4.618'
  ? 'v2.4.618 · Verified Fast Path and Final-Sheet Diagnostics'
  : version === '2.4.617'
  ? 'v2.4.617 · Focused AI Learning and Bubble Morphology'
  : version === '2.4.616'
  ? 'v2.4.616 · Real Question Comparison'
  : version === '2.4.615'
  ? 'v2.4.615 · AI-to-OMR Research Pipeline'
  : version === '2.4.613'
  ? 'v2.4.613 · UVDoc and DeepLab Research'
  : version === '2.4.612'
  ? 'v2.4.612 · Optical Cross-Check + SA24'
  : version === '2.4.611'
  ? 'v2.4.611 · Optical First-Warp Verification'
  : version === '2.4.6'
  ? 'v2.4.6 · Landmark Baseline and Curve Evidence'
  : version === '2.4.5'
  ? 'v2.4.5 · Optical Local-Grid Experiment'
  : version === '2.4.4'
  ? 'v2.4.4 · Annotated Overlay Export'
  : version === '2.4.3'
  ? 'v2.4.3 · Coordinate Evidence Fix'
  : version === '2.4.2'
  ? 'v2.4.2 · Runtime Diagnostics'
  : version === '2.4.1'
  ? 'v2.4.1 · Comparison Reliability'
  : version === '2.4.0'
  ? 'v2.4.0 · Universal Comparison Lab'
  : version === '2.3.48.1'
  ? 'v2.3.48.1 · Provisional QR-less Reading'
  : version === '2.3.48'
  ? 'v2.3.48 · SimCC Vision Rescue'
  : version === '2.3.47'
  ? 'v2.3.47 · Optional AI Page Rescue'
  : version === '2.3.46'
  ? 'v2.3.46 · QR + ArUco Rescue Experiment'
  : version === '2.3.45'
  ? 'v2.3.45 · Hybrid Recovery'
  : version === '2.3.44'
  ? 'v2.3.44 · Unredacted Diagnostics'
  : version === '2.3.43'
  ? 'v2.3.43 · Recovery Evidence'
  : version === '2.3.42'
  ? 'v2.3.42 · Stage Profiler'
  : version === '2.3.41'
  ? 'v2.3.41 · Boundary Diagnostics'
  : version === '2.3.4'
  ? 'v2.3.4 · Fast + Minimal'
  : version === '2.3.31'
  ? 'v2.3.31 · Lite OpenCV Recovery'
  : version === '2.2.6-lite.2'
  ? 'v2.2.6 · Old Version Retest (Lite + Gentle Curve)'
  : version === '2.2.6-lite.1'
  ? 'v2.2.6 LITE • Fast Registration Experiment'
  : version === '2.2.5'
  ? 'v2.2.5 Strict Marks • Multiple-Answer Scoring'
  : version === '2.2.4'
  ? 'v2.2.4 Registration & Review Hardening'
  : version === '2.2.3'
  ? 'v2.2.3 Scanner Reliability • Fail-Closed Detection'
  : version === '2.2.2'
  ? 'v2.2.2 Multi-Method Alignment • Cross-Verification'
  : version.startsWith('2.2.1-aruco-gray')
  ? 'v2.2.1 ArUco + Grayscale Experiment • Orientation + V5 Rescue'
  : version.startsWith('2.2.0-omr2')
  ? 'v2.2.0 OMR 2.1 Experiment'
  : version.startsWith('2.1.3-hybrid') ? 'v2.1.3 Hybrid Experiment' : `v${version}`;
export const APP_BUILD_ID=__APP_BUILD_ID__;
export const APP_RELEASE_LABEL=APP_BUILD_ID==='local' ? APP_VERSION : `${APP_VERSION} · ${APP_BUILD_ID}`;
export const APP_BUILD_NAME=`SFG OMR Lab ${APP_VERSION}`;

/** Build identity is compiled into each bundle, not inferred from stale cache or package version. */
export const APP_BUILD_META = __APP_BUILD_META__;
export const APP_DEPLOY_LABEL = APP_BUILD_META.source === 'vercel'
  ? `Vercel ${APP_BUILD_META.environment}`
  : APP_BUILD_META.source === 'local-dev' ? 'Local Vite dev server' : 'Local production build';
export function getBuildIdentity(): string {
  const host = typeof window !== 'undefined' ? window.location.host : 'unknown';
  return `Source: ${APP_DEPLOY_LABEL} | Scanner: v${APP_BUILD_META.version} | Commit: ${APP_BUILD_META.sha}${APP_BUILD_META.dirty ? ' (working tree modified)' : ''} | Built: ${APP_BUILD_META.builtAt} | Host: ${host}`;
}
