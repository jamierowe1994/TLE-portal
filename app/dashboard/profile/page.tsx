"use client";

import { useEffect, useRef, useState } from "react";
import AgentCompliancePanel from "@/components/AgentCompliancePanel";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import { getUser, refreshUser, updateProfile, signOut } from "@/lib/session";
import type { UserProfile } from "@/lib/types";

// Profile — edit name / mobile / photo (FileReader → data URL, TEG pattern),
// change password, sign out. The admin-managed links (agentKey, rexUserId,
// metaCampaignId) are shown read-only so agents can see what's wired up.

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4MB — stored as a data URL

const inputClass =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-gray-400";

function LinkedChip({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-gray-50 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="tnum truncate text-[13px] font-medium">
        {value ?? "Not linked yet"}
      </span>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Prime the form from the local cache instantly, then re-validate.
    const cached = getUser();
    if (cached) {
      setUser(cached);
      setName(cached.name);
      setMobile(cached.mobile);
      setPhoto(cached.photo);
      setBio(cached.bio ?? "");
    }
    refreshUser().then((u) => {
      if (cancelled || !u) return;
      setUser(u);
      setName(u.name);
      setMobile(u.mobile);
      setPhoto(u.photo);
      setBio(u.bio ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handlePhotoFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setProfileMsg({ ok: false, text: "Photo is too large — pick one under 4MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function saveProfile() {
    if (!name.trim()) {
      setProfileMsg({ ok: false, text: "Your name can't be empty." });
      return;
    }
    setSaving(true);
    setProfileMsg(null);
    try {
      const updated = await updateProfile({
        name: name.trim(),
        mobile: mobile.trim(),
        photo,
        bio: bio.trim(),
      });
      setUser(updated);
      setProfileMsg({ ok: true, text: "Profile saved." });
    } catch (e) {
      setProfileMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Could not save your profile.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    setPwMsg(null);
    if (newPw.length < 8) {
      setPwMsg({ ok: false, text: "New password must be at least 8 characters." });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    setChangingPw(true);
    try {
      // Password change lives on PATCH /api/auth/me (verified currentPassword
      // + scrypt re-hash server-side).
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPwMsg({ ok: false, text: data.error ?? "Could not change your password." });
        return;
      }
      setPwMsg({ ok: true, text: "Password changed." });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch {
      setPwMsg({ ok: false, text: "Could not change your password — try again." });
    } finally {
      setChangingPw(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  if (!user) return null; // layout guard is redirecting

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="pt-2">
        <h1 className="tracking-tight" style={{ fontSize: "clamp(32px, 3.6vw, 46px)", lineHeight: 1.05, fontWeight: 500 }}>
          Profile
        </h1>
        <p className="mt-2.5 text-[13px] text-muted">{user.email}</p>
      </div>

      {/* Details */}
      <section className="card space-y-4 p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Your details
        </h2>

        <div className="flex items-center gap-4">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={name || "Profile photo"}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full accent-soft-bg text-lg font-semibold accent-text">
              {(name || user.name || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-press rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-black/30"
            >
              {photo ? "Change photo" : "Add photo"}
            </button>
            {photo ? (
              <button
                onClick={() => setPhoto(null)}
                className="btn-press rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted transition hover:text-ink"
              >
                Remove
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handlePhotoFile(e.target.files?.[0])}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted">Mobile</label>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className={inputClass}
              placeholder="07…"
              inputMode="tel"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-muted">
            About you
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 600))}
            placeholder="A line or two about you — landlords see this when head office shares your profile."
            className="h-24 w-full resize-none rounded-xl border border-line bg-transparent p-3 text-[13px] outline-none transition focus:border-black/30"
          />
          <p className="mt-1 text-[11px] text-muted">{bio.length}/600</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="btn-press accent-bg rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {profileMsg ? (
            <span
              className={`text-[13px] ${profileMsg.ok ? "text-green-600" : "accent-text"}`}
            >
              {profileMsg.text}
            </span>
          ) : null}
        </div>
      </section>

      {/* Their own compliance certificates */}
      <AgentCompliancePanel />

      {/* Admin-managed links */}
      <section className="card space-y-3 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            Linked stats profile
          </h2>
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted">
            MANAGED BY ADMIN
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <LinkedChip label="Agent" value={user.agentKey} />
          <LinkedChip label="REX user" value={user.rexUserId} />
          <LinkedChip label="Meta campaign" value={user.metaCampaignId} />
        </div>
        <p className="text-[12px] text-muted">
          These connect your dashboard to your REX stats, Meta ads and the
          business reports. If something looks wrong, ask the admin to update
          the link — you can&apos;t edit these yourself.
        </p>
      </section>

      {/* Change password */}
      <section className="card space-y-3 p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Change password
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PasswordInput
            value={currentPw}
            onChange={setCurrentPw}
            placeholder="Current password"
          />
          <PasswordInput value={newPw} onChange={setNewPw} placeholder="New password" />
          <PasswordInput
            value={confirmPw}
            onChange={setConfirmPw}
            placeholder="Confirm new password"
            onEnter={changePassword}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={changePassword}
            disabled={changingPw || !currentPw || !newPw || !confirmPw}
            className="btn-press rounded-lg border border-line px-4 py-2 text-[13px] font-semibold transition hover:bg-gray-50 disabled:opacity-60"
          >
            {changingPw ? "Changing…" : "Change password"}
          </button>
          {pwMsg ? (
            <span className={`text-[13px] ${pwMsg.ok ? "text-green-600" : "accent-text"}`}>
              {pwMsg.text}
            </span>
          ) : null}
        </div>
      </section>

      {/* Sign out */}
      <section className="card flex items-center justify-between p-5">
        <div>
          <div className="text-[13px] font-semibold">Sign out</div>
          <div className="text-[12px] text-muted">
            Signs you out of the portal on this device.
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="btn-press rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-muted transition hover:text-ink"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
