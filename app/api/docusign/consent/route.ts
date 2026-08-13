import { NextRequest } from "next/server";

// Where DocuSign lands you after granting consent.
//
// It exists purely so the redirect doesn't dead-end on a 404 that looks like a
// failure — consent is recorded by DocuSign BEFORE the redirect fires, so by
// the time anyone reads this page the job is already done.
//
// There is deliberately no code exchange here. JWT Grant impersonates a user
// via a signed assertion; the `code` in the query string is a by-product of
// the consent flow and is not needed for anything. Exchanging it would create
// a token nobody uses.
export async function GET(req: NextRequest) {
  const error = req.nextUrl.searchParams.get("error");
  const granted = !error && req.nextUrl.searchParams.has("code");

  const title = error
    ? "Consent was not granted"
    : granted
      ? "DocuSign consent granted"
      : "DocuSign consent";
  const message = error
    ? `DocuSign returned: ${escapeHtml(error)}. Nothing has changed — you can close this and try the consent link again.`
    : granted
      ? "The portal can now read DocuSign on this account. Nothing else to do here — close this tab."
      : "This page is the landing point for DocuSign consent. Open the consent link from the admin probe to grant it.";

  return new Response(page(title, message, !!error), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
    // A consent landing page has no business in anyone's cache or index.
    status: error ? 400 : 200,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

function page(title: string, message: string, isError: boolean): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
       color:#1a1a1a;background:#fafafa;padding:24px}
  .card{max-width:26rem;background:#fff;border:1px solid #e6e6e6;border-radius:14px;padding:28px}
  h1{margin:0 0 10px;font-size:17px;font-weight:600;letter-spacing:-0.01em}
  p{margin:0;color:#666}
  .dot{width:8px;height:8px;border-radius:50%;background:${isError ? "#c0392b" : "#2d7a4f"};
       display:inline-block;margin-right:8px;vertical-align:middle}
  @media (prefers-color-scheme:dark){
    body{background:#141414;color:#f0f0f0}
    .card{background:#1c1c1c;border-color:#2e2e2e}
    p{color:#a0a0a0}
  }
</style></head>
<body><div class="card"><h1><span class="dot"></span>${title}</h1><p>${message}</p></div></body></html>`;
}
