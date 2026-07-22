"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { logIn } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import BrandMark from "@/components/BrandMark";
import PasswordInput from "@/components/PasswordInput";

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
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-10 flex items-center justify-center gap-2.5"
        >
          <BrandMark size={32} />
          <span className="text-sm font-semibold text-ink">{BRAND.name}</span>
        </Link>
        <h1 className="text-center text-2xl font-semibold tracking-tight text-ink">
          Welcome back
        </h1>
        <p className="mt-2 text-center text-sm text-muted">
          Sign in with your work email
        </p>
        <input
          autoFocus={!prefilled}
          type="email"
          className="mt-8 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-gray-400"
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
        <p className="mt-6 text-center text-sm text-muted">
          New here?{" "}
          <Link href="/signup" className="font-medium text-ink underline">
            Create an account
          </Link>
        </p>
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
