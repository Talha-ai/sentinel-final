import { useEffect, useState } from 'react';

type PermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

const PermissionStatus = () => {
  const [cameraStatus, setCameraStatus] = useState<PermissionState>('prompt');
  const [locationStatus, setLocationStatus] =
    useState<PermissionState>('prompt');

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const camera = await navigator.permissions.query({
          name: 'camera' as PermissionName,
        });
        setCameraStatus(camera.state);

        const location = await navigator.permissions.query({
          name: 'geolocation',
        });
        setLocationStatus(location.state);

        camera.onchange = () => setCameraStatus(camera.state);
        location.onchange = () => setLocationStatus(location.state);
      } catch {
        setCameraStatus('unavailable');
        setLocationStatus('unavailable');
      }
    };

    checkPermissions();
  }, []);

  const renderMessage = () => {
    if (cameraStatus === 'denied' && locationStatus === 'denied') {
      return (
        <div className="flex flex-col gap-10">
          <div className="flex gap-3">
            <div className="flex items-start">
              <img src="/camera2.png" alt="camera" width={60} height={30} />
            </div>

            <div className="flex flex-col items-start pt-1">
              <p className="text-sm">
                Please allow camera permission to scan fingerprint
              </p>
              <a
                href="https://support.google.com/chrome/answer/2693767?hl=en"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 text-sm"
              >
                How do I allow camera?
              </a>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex items-start">
              <img src="/location.png" alt="camera" width={60} height={30} />
            </div>

            <div className="flex flex-col items-start">
              <p className="text-sm">
                Please allow location permission to scan fingerprint
              </p>
              <a
                href="https://support.google.com/chrome/answer/142065?hl=en"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 text-sm"
              >
                How do I allow location?
              </a>
            </div>
          </div>
        </div>
      );
    }

    if (cameraStatus === 'denied') {
      return (
        <div className="flex gap-3">
          <div className="flex items-start">
            <img src="/camera2.png" alt="camera" width={60} height={30} />
          </div>

          <div className="flex flex-col items-start pt-1">
            <p className="text-sm">
              Please allow camera permission to scan fingerprint
            </p>
            <a
              href="https://example.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 text-sm"
            >
              How do I allow camera?
            </a>
          </div>
        </div>
      );
    }

    if (locationStatus === 'denied') {
      return (
        <div className="flex gap-3">
          <div className="flex items-start">
            <img src="/location.png" alt="camera" width={60} height={30} />
          </div>

          <div className="flex flex-col items-start">
            <p className="text-sm">
              Please allow location permission to scan fingerprint
            </p>
            <a
              href="https://support.google.com/chrome/answer/142065?hl=en"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 text-sm"
            >
              How do I allow location?
            </a>
          </div>
        </div>
      );
    }

    if (cameraStatus === 'unavailable' || locationStatus === 'unavailable') {
      return (
        <p className="text-gray-900">
          Permissions API is not supported in this browser.
        </p>
      );
    }

    return null;
  };

  const message = renderMessage();

  if (!message) return null;

  return (
    <div className="absolute inset-0 z-50 bg-[#edeefe] text-gray-900 flex flex-col items-center justify-center p-10 rounded-xl">
      {message}
    </div>
  );
};

export default PermissionStatus;
