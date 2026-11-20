import { version } from '../../package.json';
declare const __APP_BUILD_ID__: string;
export const APP_VERSION = version.startsWith('2.2.1-aruco-gray')
  ? 'v2.2.1 ArUco + Grayscale Experiment • Orientation + V5 Rescue'
  : version.startsWith('2.2.0-omr2')
  ? 'v2.2.0 OMR 2.1 Experiment'
  : version.startsWith('2.1.3-hybrid') ? 'v2.1.3 Hybrid Experiment' : `v${version}`;
export const APP_BUILD_ID=__APP_BUILD_ID__;
export const APP_RELEASE_LABEL=APP_BUILD_ID==='local' ? APP_VERSION : `${APP_VERSION} · ${APP_BUILD_ID}`;
export const APP_BUILD_NAME=`SFG OMR Lab ${APP_VERSION} (ArUco Registration • Calibrated Grayscale Beta)`;
