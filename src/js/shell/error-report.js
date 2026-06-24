/**
 * error-report.js — best-effort client-side error reporting.
 *
 * Only unexpected/global errors and device-write failures should call this. It
 * must never throw or block the UI; the server side is equally best-effort.
 */

const ENDPOINT = '/api/error';
const SESSION_KEY = 'kobopatch-webui:error-session-id';
const MAX_REPORTS_PER_LOAD = 10;

let sessionId = null;
let sentCount = 0;
const seen = new Set();

function appVersion() {
    return (typeof globalThis !== 'undefined' && globalThis.__APP_VERSION__) || 'unknown';
}

function userAgent() {
    try {
        return globalThis.navigator?.userAgent || null;
    } catch {
        return null;
    }
}

function randomId() {
    try {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch {}
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getSessionId() {
    if (sessionId) return sessionId;
    try {
        sessionId = globalThis.sessionStorage?.getItem(SESSION_KEY) || null;
        if (sessionId) return sessionId;
    } catch {}

    sessionId = randomId();
    try {
        globalThis.sessionStorage?.setItem(SESSION_KEY, sessionId);
    } catch {}
    return sessionId;
}

function errorMessage(error) {
    if (error && typeof error.message === 'string' && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    try {
        return String(error || 'Unknown error');
    } catch {
        return 'Unknown error';
    }
}

function errorStack(error) {
    return error && typeof error.stack === 'string' && error.stack ? error.stack : null;
}

function payloadFor({ kind = 'unexpected', error, flowStep = null }) {
    return {
        sessionId: getSessionId(),
        appVersion: appVersion(),
        kind,
        message: errorMessage(error),
        stack: errorStack(error),
        userAgent: userAgent(),
        flowStep,
    };
}

function dedupeKey(payload) {
    return [payload.kind, payload.message, payload.stack, payload.flowStep].join('\n');
}

function bodyFor(payload) {
    const json = JSON.stringify(payload);
    try {
        if (typeof Blob !== 'undefined') return new Blob([json], { type: 'application/json' });
    } catch {}
    return json;
}

function send(payload) {
    const body = bodyFor(payload);
    const nav = globalThis.navigator;
    if (nav && typeof nav.sendBeacon === 'function') {
        try {
            if (nav.sendBeacon(ENDPOINT, body)) return true;
        } catch {}
    }

    if (typeof globalThis.fetch === 'function') {
        try {
            globalThis
                .fetch(ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: typeof Blob !== 'undefined' && body instanceof Blob ? JSON.stringify(payload) : body,
                    keepalive: true,
                })
                .catch(() => {});
            return true;
        } catch {}
    }

    return false;
}

export function reportError(input = {}) {
    try {
        const payload = payloadFor(input);
        const key = dedupeKey(payload);
        if (seen.has(key)) return false;
        if (sentCount >= MAX_REPORTS_PER_LOAD) return false;
        seen.add(key);
        sentCount += 1;
        return send(payload);
    } catch {
        return false;
    }
}

export function resetErrorReporterForTests() {
    sessionId = null;
    sentCount = 0;
    seen.clear();
}
