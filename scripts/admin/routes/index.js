import { handleAdminErrorsDownload, handleAdminErrorsPage } from './admin.js';
import { handleErrorReport } from './error-report.js';

export * from './admin.js';
export * from './error-report.js';

export function errorLoggingEnabledFromEnv(env = process.env) {
    return !/^(0|false|off|no)$/i.test(env.ERROR_LOGGING ?? '');
}

export function handleAdminBackendRoute(
    req,
    res,
    { storageDir, url = new URL(req.url || '/', 'http://localhost'), errorLoggingEnabled = errorLoggingEnabledFromEnv() } = {},
) {
    if (req.method === 'POST' && url.pathname === '/api/error') {
        handleErrorReport(req, res, { storageDir, enabled: errorLoggingEnabled });
        return true;
    }

    if (url.pathname === '/admin/errors.sqlite') {
        handleAdminErrorsDownload(req, res, { storageDir });
        return true;
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/') {
        handleAdminErrorsPage(req, res, { storageDir, url });
        return true;
    }

    return false;
}
