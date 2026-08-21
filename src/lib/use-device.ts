import { useEffect, useState } from "react";
import { detectDevice, unknownDevice, type DeviceInfo } from "./device-info";

/** Returns the detected device for the current browser (client-side only). */
export function useDevice(): DeviceInfo {
  const [device, setDevice] = useState<DeviceInfo>(unknownDevice);

  useEffect(() => {
    let alive = true;
    void detectDevice().then((d) => {
      if (alive) setDevice(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  return device;
}
