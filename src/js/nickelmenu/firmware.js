import { firmwareMajor } from '../kobo/version.js';

/** Manual downloads know the firmware family, but not the device or exact build. */
export function nickelMenuDeviceInfo(session) {
    if (!session.manualMode) return session.device?.deviceInfo ?? null;
    return session.manualNickelMenuFirmware === '6' ? { firmware: '6.0' } : null;
}

export function nickelMenuPackage(deviceInfo) {
    const major = firmwareMajor(deviceInfo?.firmware) ?? 4;
    if (major === 6) return { id: 'nickelmenu-qt6', asset: 'NickelMenu-Qt6.tgz', filename: 'Kobo.tgz' };
    if (major === 4) return { id: 'nickelmenu', asset: 'NickelMenu.tgz', filename: 'KoboRoot.tgz' };
    throw new Error('NickelMenu installation supports Kobo software 4.x and 6.x only.');
}

/** Features must explicitly opt into a new firmware family before installation. */
export function featureFirmwareDisabledReason(feature, deviceInfo) {
    const major = firmwareMajor(deviceInfo?.firmware);
    if (major === null || (feature.supportedFirmwareMajors || [4]).includes(major)) return undefined;
    return `Not yet available for Kobo OS ${major}.`;
}
