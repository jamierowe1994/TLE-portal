"use client";

import { useEffect, useRef, useState } from "react";
import AgentCompliancePanel from "@/components/AgentCompliancePanel";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import { getUser, refreshUser, updateProfile, signOut } from "@/lib/session";
import type { UserProfile } from "@/lib/types";
import SaveButton from "@/components/SaveButton";

// Profile — edit name / mobile / photo (FileReader → data URL, TEG pattern),
// change password, sign out. The admin-managed links (agentKey, rexUserId,
// metaCampaignId) are shown read-only so agents can see what's wired up.

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4MB — stored as a data URL

const inputClass =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-gray-400";

function LinkedChip({ label, value }: { label: string; value: string | null }) {
  return (
    // Label above value, not beside it: side by side in a quarter-width
    // column the value had ~30px and every one of them truncated.
    <div className="min-w-0 rounded-lg border border-line bg-transparent px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="tnum truncate text-[13px] font-medium">
        {value ?? "Not linked yet"}
      </div>
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

  async function saveProfile(): Promise<boolean> {
    if (!name.trim()) {
      setProfileMsg({ ok: false, text: "Your name can't be empty." });
      return false;
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
      return true;
    } catch (e) {
      setProfileMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Could not save your profile.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(): Promise<boolean> {
    setPwMsg(null);
    if (newPw.length < 8) {
      setPwMsg({ ok: false, text: "New password must be at least 8 characters." });
      return false;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: "New passwords don't match." });
      return false;
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
        return false;
      }
      setPwMsg({ ok: true, text: "Password changed." });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      return true;
    } catch {
      setPwMsg({ ok: false, text: "Could not change your password — try again." });
      return false;
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
    <div className="relative space-y-5">
      {/* A large, faint illustration anchored bottom-right, sitting BEHIND the
          cards — the page reads as considered rather than a stack of forms.
          Every card above it is card-flat (transparent), so it shows through
          them, which is the intent. pointer-events-none so it can never eat a
          click; hidden below lg where the columns collapse and there is no
          spare room for it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-6 right-0 -z-10 hidden w-[26rem] max-w-[55%] select-none opacity-[0.09] lg:block"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/illustrations/notioly/accomplishment.svg" alt="" className="w-full" />
      </div>
      <div className="pt-2">
        <h1 className="tracking-tight" style={{ fontSize: "clamp(32px, 3.6vw, 46px)", lineHeight: 1.05, fontWeight: 500 }}>
          Profile
        </h1>
      </div>

      {/* Two columns: what's ABOUT the agent (details, compliance) takes the
          wide left; the account plumbing (admin links, password, sign out)
          stacks on the right. Single column again below lg. */}
      <div className="grid items-start gap-5 lg:grid-cols-4">
      <div className="space-y-5 lg:col-span-3">
      {/* Details */}
      <section className="card card-flat space-y-4 p-5">
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
            {/* Read-only on purpose: the email IS the login and the key every
                integration matches on, so changing it here would silently
                break the REX/PayProp links. Shown, not editable. */}
            <label className="mb-1 block text-[12px] font-medium text-muted">Email</label>
            <input
              value={user.email}
              readOnly
              disabled
              title="Your email is your sign-in — ask an admin to change it."
              className={`${inputClass} cursor-not-allowed text-muted opacity-70`}
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
          <SaveButton onSave={saveProfile} label="Save changes" disabled={saving} />
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
      </div>

      <div className="space-y-5">
      {/* Admin-managed links */}
      <section className="card card-flat space-y-3 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            Linked stats profile
          </h2>
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted">
            MANAGED BY ADMIN
          </span>
        </div>
        {/* Stacked, not three-across: this column is a quarter of the page,
            and the three-up grid was truncating every value (review of the
            live screenshot). */}
        <div className="grid grid-cols-1 gap-2">
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
      <section className="card card-flat space-y-3 p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Change password
        </h2>
        <div className="grid grid-cols-1 gap-3">
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
          <SaveButton
            onSave={changePassword}
            label="Change password"
            savingLabel="Changing password"
            variant="quiet"
            disabled={changingPw || !currentPw || !newPw || !confirmPw}
          />
          {pwMsg ? (
            <span className={`text-[13px] ${pwMsg.ok ? "text-green-600" : "accent-text"}`}>
              {pwMsg.text}
            </span>
          ) : null}
        </div>
      </section>

      {/* Sign out */}
      <section className="card card-flat space-y-3 p-5">
        <div>
          <div className="text-[13px] font-semibold">Sign out</div>
          <div className="text-[12px] text-muted">
            Signs you out of the portal on this device.
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="btn-press w-full whitespace-nowrap rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-muted transition hover:text-ink"
        >
          Sign out
        </button>
      </section>
      </div>
      </div>
    </div>
  );
}
