"use client";

// Client-side session layer — plain fetch wrappers around /api/auth/*.
// The httpOnly cookie does the real auth; localStorage ("tle_user") is only a
// render cache, always repopulated from server responses.

import type { UserProfile } from "@/lib/types";

const USER_KEY = "tle_user";

/* ------------------------------------------------------------------------ */
/* Local cache                                                               */
/* ------------------------------------------------------------------------ */

export function getUser(): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

export function saveUser(user: UserProfile): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // storage unavailable — cache is optional
  }
}

function clearUser(): void {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------------ */
/* Server round-trips                                                        */
/* ------------------------------------------------------------------------ */

/** Re-validate the session with the server; null = signed out. */
export async function refreshUser(): Promise<UserProfile | null> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) {
      clearUser();
      return null;
    }
    const data = (await res.json()) as { user: UserProfile | null };
    if (!data.user) {
      clearUser();
      return null;
    }
    saveUser(data.user);
    return data.user;
  } catch {
    return getUser();
  }
}

export interface SignUpPayload {
  name: string;
  email: string;
  password: string;
  mobile: string;
  photo: string | null;
}

export async function signUp(payload: SignUpPayload): Promise<UserProfile> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { user?: UserProfile; error?: string };
  if (!res.ok || !data.user) {
    throw new Error(data.error ?? "Could not create your account.");
  }
  saveUser(data.user);
  return data.user;
}

/** → { exists, allowed }. Fails open on network error so signup can proceed. */
export async function checkEmail(
  email: string
): Promise<{ exists: boolean; allowed: boolean }> {
  try {
    const res = await fetch("/api/auth/check-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return { exists: false, allowed: true };
    return (await res.json()) as { exists: boolean; allowed: boolean };
  } catch {
    return { exists: false, allowed: true };
  }
}

export async function logIn(
  email: string,
  password: string,
  remember = true
): Promise<UserProfile> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, remember }),
  });
  const data = (await res.json()) as { user?: UserProfile; error?: string };
  if (!res.ok || !data.user) {
    throw new Error(data.error ?? "Incorrect email or password.");
  }
  saveUser(data.user);
  return data.user;
}

export async function updateProfile(patch: {
  name?: string;
  mobile?: string;
  photo?: string | null;
  bio?: string | null;
}): Promise<UserProfile> {
  const res = await fetch("/api/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await res.json()) as { user?: UserProfile; error?: string };
  if (!res.ok || !data.user) {
    throw new Error(data.error ?? "Could not update your profile.");
  }
  saveUser(data.user);
  return data.user;
}

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // best-effort — clear the local cache regardless
  }
  clearUser();
}
