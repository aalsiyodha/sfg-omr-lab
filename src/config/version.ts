// All user-visible version labels are derived from the package release version.
// Bump package.json and package-lock.json together for a new release.
import { version } from '../../package.json';

export const APP_VERSION = `v${version}`;
export const APP_BUILD_ID = __APP_BUILD_ID__;
export const APP_RELEASE_LABEL = APP_BUILD_ID === 'local'
  ? APP_VERSION
  : `${APP_VERSION} · ${APP_BUILD_ID}`;
export const APP_BUILD_NAME = `SFG OMR Lab ${APP_VERSION} (Orientation Validation • Robust Registration • Multi-Mark Review)`;
