"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import BrandMark from "@/components/BrandMark";
import PasswordInput from "@/components/PasswordInput";
import { signUp, checkEmail } from "@/lib/session";

// One-question-at-a-time signup, simplified from TEG for TLE:
// name → email (domain-gated) → password → mobile (optional) → /dashboard.

type StepId = "name" | "email" | "password" | "mobile";

const STEPS: StepId[] = ["name", "email", "password", "mobile"];

export default function SignupPage() {
  const router = useRouter();

  const [step, setStep] = useState<StepId>("name");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Set when the entered email already has an account — the email step swaps
  // to a "you're already with us, sign in" card instead of pressing on.
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const stepIndex = STEPS.indexOf(step);
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  function go(next: StepId) {
    setError("");
    setStep(next);
  }

  function back() {
    if (stepIndex > 0) go(STEPS[stepIndex - 1]);
  }

  async function submitEmail() {
    const trimmed = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setError("That doesn't look like an email address.");
      return;
    }
    if (checkingEmail) return;
    // Catch a returning user or a blocked domain HERE, not after they've
    // filled the whole form.
    setCheckingEmail(true);
    const { exists, allowed } = await checkEmail(trimmed);
    setCheckingEmail(false);
    if (exists) {
      setAlreadyRegistered(true);
      return;
    }
    if (!allowed) {
      setError(
        `Use your @${BRAND.domains[0]} email — this portal is for ${BRAND.name} partners and head office.`
      );
      return;
    }
    go("password");
  }

  async function completeSignup() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await signUp({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        mobile: mobile.trim(),
        photo: null,
      });
      router.push("/dashboard");
    } catch (e) {
      setSubmitting(false);
      const message =
        e instanceof Error ? e.message : "Could not create your account.";
      // Send the user back to fix a duplicate email / weak password. A
      // duplicate (they registered in another tab mid-wizard) gets the
      // friendly "sign in instead" card rather than a bare error.
      if (/already exists/i.test(message)) {
        setAlreadyRegistered(true);
        go("email");
      } else if (/email/i.test(message)) {
        setError(message);
        go("email");
      } else if (/password/i.test(message)) {
        setError(message);
        go("password");
      } else {
        setError(message);
      }
    }
  }

  const inputClass =
    "w-full rounded-xl border border-line bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-gray-400";
  const primaryBtn =
    "btn-press rounded-xl bg-accent px-8 py-3 text-sm font-medium text-white transition hover:bg-accent-dark disabled:opacity-40 disabled:hover:bg-accent";
  const secondaryBtn =
    "rounded-xl border border-line px-6 py-3 text-sm font-medium text-muted transition hover:bg-gray-50";

  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* Top bar with progress */}
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark size={28} />
            <span className="text-sm font-semibold text-ink">
              {BRAND.name}
            </span>
          </Link>
          <span className="text-xs text-muted">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
        </div>
        <div className="h-0.5 bg-gray-100">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        {/* ---- Name ---- */}
        {step === "name" && (
          <div className="fade-up" key="name">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              First things first — what&apos;s your name?
            </h1>
            <p className="mt-3 text-muted">
              Use your name as it appears on the TLE partner roster so we can
              link your figures automatically.
            </p>
            <input
              autoFocus
              className={`${inputClass} mt-8`}
              placeholder="e.g. Rhiannon Dodge"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && go("email")}
            />
            <div className="mt-8">
              <button
                className={primaryBtn}
                disabled={!name.trim()}
                onClick={() => go("email")}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ---- Email (domain-gated) ---- */}
        {step === "email" && !alreadyRegistered && (
          <div className="fade-up" key="email">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              What&apos;s your work email, {name.trim().split(" ")[0]}?
            </h1>
            <p className="mt-3 text-muted">
              Use your @{BRAND.domains[0]} email.
            </p>
            <input
              autoFocus
              type="email"
              className={`${inputClass} mt-8`}
              placeholder={`you@${BRAND.domains[0]}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && email && !checkingEmail && submitEmail()
              }
            />
            {error && <p className="mt-3 text-sm text-accent">{error}</p>}
            <div className="mt-8 flex gap-3">
              <button className={secondaryBtn} onClick={back}>
                Back
              </button>
              <button
                className={primaryBtn}
                disabled={!email || checkingEmail}
                onClick={submitEmail}
              >
                {checkingEmail ? "Checking…" : "Continue"}
              </button>
            </div>
          </div>
        )}

        {/* ---- Already registered — recognise them and send to sign-in ---- */}
        {step === "email" && alreadyRegistered && (
          <div className="fade-up" key="already">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              Welcome back, {name.trim().split(" ")[0]}
            </h1>
            <p className="mt-3 text-muted">
              You&apos;ve already got an account with{" "}
              <span className="font-medium text-ink">
                {email.trim().toLowerCase()}
              </span>
              . No need to sign up again — just sign in.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={`/login?email=${encodeURIComponent(
                  email.trim().toLowerCase()
                )}`}
                className={primaryBtn}
              >
                Sign in instead
              </Link>
              <button
                className={secondaryBtn}
                onClick={() => {
                  setAlreadyRegistered(false);
                  setEmail("");
                }}
              >
                Use a different email
              </button>
            </div>
          </div>
        )}

        {/* ---- Password ---- */}
        {step === "password" && (
          <div className="fade-up" key="password">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              Create a password
            </h1>
            <p className="mt-3 text-muted">
              You&apos;ll use this with your email to sign in. At least 8
              characters.
            </p>
            <div className="mt-8">
              <PasswordInput
                autoFocus
                placeholder="Choose a password"
                value={password}
                onChange={setPassword}
                onEnter={() => password.length >= 8 && go("mobile")}
              />
            </div>
            {error && <p className="mt-3 text-sm text-accent">{error}</p>}
            <div className="mt-8 flex gap-3">
              <button className={secondaryBtn} onClick={back}>
                Back
              </button>
              <button
                className={primaryBtn}
                disabled={password.length < 8}
                onClick={() => go("mobile")}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ---- Mobile (optional) → create account ---- */}
        {step === "mobile" && (
          <div className="fade-up" key="mobile">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              What&apos;s the best mobile number for you?
            </h1>
            <p className="mt-3 text-muted">
              Optional — you can add or change it later in your profile.
            </p>
            <input
              autoFocus
              type="tel"
              className={`${inputClass} mt-8`}
              placeholder="07700 900000"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !submitting && completeSignup()
              }
            />
            {error && <p className="mt-3 text-sm text-accent">{error}</p>}
            <div className="mt-8 flex gap-3">
              <button className={secondaryBtn} onClick={back}>
                Back
              </button>
              <button
                className={primaryBtn}
                disabled={submitting}
                onClick={completeSignup}
              >
                {submitting
                  ? "Creating account…"
                  : mobile.trim()
                    ? "Create account"
                    : "Skip and create account"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
