import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { BRAND } from "@/lib/brand";

// Landing page — minimal and fast. Brand mark, strapline, sign in / create
// account, and a small muted Admin link in the footer. Server component.

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <BrandMark size={64} rounded="rounded-2xl" />
        <h1 className="mt-6 text-center text-3xl font-semibold tracking-tight text-ink">
          {BRAND.name}
        </h1>
        <p className="mt-2 text-center text-base text-muted">Partner Portal</p>
        <p className="mt-4 max-w-sm text-center text-sm text-muted">
          Your funnel, your ads, your forecast — everything you need to run
          your patch, in one place.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="btn-press rounded-xl bg-accent px-8 py-3 text-sm font-medium text-white transition hover:bg-accent-dark"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="btn-press rounded-xl border border-line px-8 py-3 text-sm font-medium text-ink transition hover:bg-gray-50"
          >
            Create account
          </Link>
        </div>
      </div>
      <footer className="flex items-center justify-center gap-4 px-6 py-6 text-xs text-muted">
        <span>
          {BRAND.name} · part of The Experts Group
        </span>
        <span aria-hidden="true">·</span>
        <Link href="/admin" className="transition hover:text-ink">
          Admin
        </Link>
      </footer>
    </main>
  );
}
