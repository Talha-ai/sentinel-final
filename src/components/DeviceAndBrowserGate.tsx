/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import DeviceAndBrowserAlert from './DeviceAndBrowserAlert';

const isMobile = () => {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
};

const isBrave = () => {
  if (typeof navigator === 'undefined') return false;
  if ((navigator as any).brave) {
    return true;
  } else {
    return false;
  }
};
let userA: string;
const isStrictChrome = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  userA = ua;
  return (
    (ua.includes('Chrome') &&
      !ua.includes('Edg') &&
      !ua.includes('OPX') &&
      !ua.includes('OPR') &&
      !ua.includes('SamsungBrowser') &&
      !isBrave()) ||
    (ua.includes('CriOS') && ua.includes('Mac OS X'))
  );
};

export default function DeviceAndBrowserGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [mobile, setMobile] = useState(false);
  const [chrome, setChrome] = useState(false);

  useEffect(() => {
    const isMob = isMobile();
    const isChr = isStrictChrome();
    setMobile(isMob);
    setChrome(isChr);
    setAllowed(isMob && isChr);
  }, []);

  if (allowed === null) return null;

  return allowed ? (
    children
  ) : (
    <DeviceAndBrowserAlert mobile={mobile} chrome={chrome} ua={userA} />
  );
}
