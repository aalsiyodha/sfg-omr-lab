// All user-visible version labels are derived from the package release version.
// Bump package.json and package-lock.json together for a new release.
import { version } from '../../package.json';

// Injected by Vite at build time.
declare const __APP_BUILD_ID__: string;

export const APP_VERSION = version.startsWith('2.1.3-hybrid')
  ? 'v2.1.3 Hybrid Experiment'
  : `v${version}`;
export const APP_BUILD_ID = __APP_BUILD_ID__;
export const APP_RELEASE_LABEL = APP_BUILD_ID === 'local'
  ? APP_VERSION
  : `${APP_VERSION} · ${APP_BUILD_ID}`;
export const APP_BUILD_NAME = `SFG OMR Lab ${APP_VERSION} (Selective Ink Review • Offline Beta)`;
