import { useCallback, useEffect, useState } from "react";
import { currentStaff } from "@/mocks/data";

export interface EditableProfile {
  name: string;
  email: string;
}

const KEY = "campusattend.profile";
const EVENT = "campusattend:profile-change";

export const defaultProfile: EditableProfile = {
  name: currentStaff.name,
  email: currentStaff.email,
};

function read(): EditableProfile {
  if (typeof window === "undefined") return defaultProfile;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultProfile;
    const parsed = JSON.parse(raw) as Partial<EditableProfile>;
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : defaultProfile.name,
      email: typeof parsed.email === "string" && parsed.email.trim() ? parsed.email : defaultProfile.email,
    };
  } catch {
    return defaultProfile;
  }
}

/** Editable staff profile persisted on the device, shared across components. */
export function useProfile() {
  const [profile, setProfile] = useState<EditableProfile>(defaultProfile);

  useEffect(() => {
    setProfile(read());
    const sync = () => setProfile(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const saveProfile = useCallback((next: EditableProfile) => {
    const clean: EditableProfile = { name: next.name.trim(), email: next.email.trim() };
    window.localStorage.setItem(KEY, JSON.stringify(clean));
    window.dispatchEvent(new Event(EVENT));
    setProfile(clean);
  }, []);

  return { profile, saveProfile };
}

export function validateProfile({ name, email }: EditableProfile): string | null {
  const n = name.trim();
  const e = email.trim();
  if (!n) return "Name cannot be empty.";
  if (n.length > 80) return "Name must be under 80 characters.";
  if (!e) return "Email cannot be empty.";
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return "Enter a valid email address.";
  return null;
}
