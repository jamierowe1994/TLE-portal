"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { logIn } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import PasswordInput from "@/components/PasswordInput";

/**
 * A different illustration each visit — the same line-art set the rest of the
 * portal uses, so signing in already looks like the product.
 *
 * Deliberately NOT the whole folder. "Lost the way" and "looking for
 * something" are the two that read as confusion, which is the wrong first
 * impression on a screen whose only job is to let someone in.
 */
const ART = [
  "buildings",
  "moving",
  "checking-the-calendar",
  "checklist",
  "to-do-list",
  "tasks",
  "growth",
  "piggy-bank",
  "accomplishment",
  "fast-worker",
  "reminder",
  "embracing-the-universe",
] as const;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Prefilled when handed over from signup ("you already have an account").
  const prefilled = params.get("email") ?? "";
  const [email, setEmail] = useState(prefilled);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Picked after mount, never during render. Choosing at render time hands the
  // server one illustration and the client another, which React reports as a
  // hydration mismatch. The panel holds its height so nothing jumps when it
  // arrives.
  const [art, setArt] = useState<string | null>(null);
  useEffect(() => {
    setArt(ART[Math.floor(Math.random() * ART.length)]);
  }, []);

  async function signIn() {
    const trimmed = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setError("That doesn't look like an email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Duo admin login: Susan (admin) → /admin, Kirstie (pre-tenancy) →
      // /pretenancy, agents → their dashboard.
      const user = await logIn(trimmed, password, remember);
      router.push(user.isAdmin ? "/admin" : user.isPreTenancy ? "/pretenancy" : "/dashboard");
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not sign you in.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-line bg-card shadow-xl md:grid-cols-2">
        {/* ---- the picture half ---- */}
        <div className="relative hidden items-center justify-center bg-page p-10 md:flex">
          {/* Fixed height so the card doesn't resize when the art lands. */}
          <div className="flex h-[380px] w-full items-center justify-center">
            {art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/illustrations/notioly/${art}.svg`}
                alt=""
                aria-hidden
                className="fade-up max-h-full max-w-full object-contain"
              />
            ) : null}
          </div>
        </div>

        {/* ---- the sign-in half ---- */}
        <div className="flex flex-col justify-center px-8 py-12 sm:px-12">
          <h1 className="written text-[34px] leading-none text-ink">TLE OS</h1>
          <p className="mt-3 text-sm text-muted">Sign in with your work email.</p>

          <input
            autoFocus={!prefilled}
            type="email"
            className="mt-8 w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-black/30"
            placeholder={`you@${BRAND.domains[0]}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && signIn()}
          />
          <div className="mt-3">
            <PasswordInput
              autoFocus={!!prefilled}
              placeholder="Password"
              value={password}
              onChange={setPassword}
              onEnter={signIn}
            />
          </div>
          <label className="mt-4 flex cursor-pointer select-none items-center gap-2.5 text-sm text-muted">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-line accent-[#E31F36]"
            />
            Keep me signed in
          </label>
          {error && <p className="mt-3 text-sm text-accent">{error}</p>}
          <button
            onClick={signIn}
            disabled={busy}
            className="btn-press mt-4 w-full rounded-xl bg-accent py-3 text-sm font-medium text-white transition hover:bg-accent-dark disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="mt-6 text-sm text-muted">
            New here?{" "}
            <Link href="/signup" className="font-medium text-ink underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
