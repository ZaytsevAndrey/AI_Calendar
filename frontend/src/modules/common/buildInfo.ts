declare const __BUILD_SHA__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

const BUILD_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'unknown';
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

export function buildLabel(): string {
    return BUILD_TIME ? `${BUILD_SHA} · ${BUILD_TIME}` : BUILD_SHA;
}
