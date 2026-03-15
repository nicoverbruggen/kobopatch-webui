(() => {
    const device = new KoboDevice();

    // DOM elements
    const browserWarning = document.getElementById('browser-warning');
    const stepConnect = document.getElementById('step-connect');
    const stepDevice = document.getElementById('step-device');
    const stepError = document.getElementById('step-error');
    const btnConnect = document.getElementById('btn-connect');
    const btnDisconnect = document.getElementById('btn-disconnect');
    const btnRetry = document.getElementById('btn-retry');
    const errorMessage = document.getElementById('error-message');
    const deviceStatus = document.getElementById('device-status');

    // Check browser support
    if (!KoboDevice.isSupported()) {
        browserWarning.hidden = false;
        btnConnect.disabled = true;
    }

    function showStep(step) {
        stepConnect.hidden = true;
        stepDevice.hidden = true;
        stepError.hidden = true;
        step.hidden = false;
    }

    function showDeviceInfo(info) {
        document.getElementById('device-model').textContent = info.model;
        document.getElementById('device-serial').textContent = info.serial;
        document.getElementById('device-firmware').textContent = info.firmware;
        if (info.isSupported) {
            deviceStatus.className = 'status-supported';
            deviceStatus.textContent = 'This device and firmware version are supported for patching.';
        } else {
            deviceStatus.className = 'status-unsupported';
            deviceStatus.textContent =
                'Firmware ' + info.firmware + ' is not currently supported. ' +
                'Expected ' + SUPPORTED_FIRMWARE + '.';
        }

        showStep(stepDevice);
    }

    function showError(message) {
        errorMessage.textContent = message;
        showStep(stepError);
    }

    btnConnect.addEventListener('click', async () => {
        try {
            const info = await device.connect();
            showDeviceInfo(info);
        } catch (err) {
            // User cancelled the picker
            if (err.name === 'AbortError') return;
            showError(err.message);
        }
    });

    btnDisconnect.addEventListener('click', () => {
        device.disconnect();
        showStep(stepConnect);
    });

    btnRetry.addEventListener('click', () => {
        device.disconnect();
        showStep(stepConnect);
    });
})();
