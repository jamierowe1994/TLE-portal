import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import {
  getAgentListings,
  getAgentPortfolioProperties,
  probeCompliance,
  PROPERTY_COMPLIANCE,
  type ComplianceProbeRow,
} from "@/lib/rex-stats";
import { rexCall, rexRows } from "@/lib/rex";

// What REX actually holds against a property, and what the Compliance page does
// with it.
//
// The page can't answer "has everything been pulled through", because three
// different failures look identical on it: REX has no record, REX has a record
// of a type we don't recognise, and REX ran out of rows part-way through our
// question. All three render as ALL CLEAR or NOTHING RECORDED. This route pulls
// them apart by asking REX one parent id at a time with full offset paging —
// the slow, complete way — and then asking the SAME question the way the pages
// ask it, so the gap between the two row counts is the truncation, measured
// rather than argued about.
//
// GET /api/my/compliance-debug?listingId=X        one property (fast, the default)
// GET /api/my/compliance-debug?all=1[&book=managed] the book, hard-capped
//
// Deliberately slow: it trades speed for truth, which is the opposite of every
// other route here. Never call it from a page.
//
// What ComplianceEntries actually supports, established against the live account
// 31 Jul 2026 (describeModel works on this model, despite no record of it in the
// repo before now) — worth knowing before extending this:
//   • searchable: id, type_id, parent_object_id, parent_object_type_id, sub_type_id,
//     sub_type_record_id, source_id, is_required, system_record_state, system_ctime,
//     system_modtime, system_created_user_id, system_modified_user_id.
//     NOT parent_object_type (the field the rows come back with) — use the _id form.
//   • match types: = != between in notin < <= > >= like …  So "every type except
//     the ones we know" is one predicate — but still 100 rows a page, so the
//     type census below has to walk it, not peek at page one.
//   • result_format "ids" pages up to 1,000,000 rows against the default's 100 —
//     the way to COUNT a known type without walking. It cannot find UNKNOWN
//     types: it returns ids, not type_ids.
export const maxDuration = 120;

// A book-wide sweep is one paged REX call per parent id, and REX hard-aborts at
// 8s a call. Twelve properties is 24 ids — enough to prove a pattern, small
// enough to come back.
const MAX_SWEEP_PROPERTIES = 12;

// DIAGNOSTIC ASSUMPTION, not agreed policy. There is no expected-certificate
// set anywhere in this codebase, and there can't be a blanket one — gas safety
// only applies where there's gas, HMO licences only to licensable HMOs. These
// three are here so "REX holds no EICR at all" can be DISTINGUISHED from "we
// failed to fetch the EICR". Nothing on any page depends on this list.
const EXPECTED_TYPES = ["epc", "eicr", "gas_safety"];

// REX's default result format hard-caps at 100 rows per call.
const REX_PAGE = 100;
// The notin predicate matches ~2,200 rows on this account (31 Jul 2026), so one
// page sees under 7% of them — and a NEWLY added type is the worst case, because
// its rows are the newest and sort last. Walk the lot. 40 pages is 4,000 rows,
// comfortable headroom over today's 2,200.
const CENSUS_PAGE_CEILING = 40;
// …but bounded by the clock as well as the page count: REX aborts a call at 8s,
// and this route dies at maxDuration. Stop walking with time left to spend on
// the per-type counts, and SAY the walk stopped.
const CENSUS_BUDGET_MS = 45_000;

interface AccountCensus {
  types: Array<{ typeId: string; count: number | null; contactLevel: boolean }>;
  /** True when the walk stopped early — `types` is then a floor, not a total. */
  truncated: boolean;
  rowsWalked: number;
}

/**
 * Every entry type REX holds that PROPERTY_COMPLIANCE doesn't know — across the
 * WHOLE account, not just this agent's book, so "are we dropping certificates?"
 * gets a business-wide answer. `notin` makes it one paged walk plus one count
 * per type found; the per-property census below only ever sees what's probed.
 *
 * The walk is the whole point. result_format "ids" can't substitute — it returns
 * ids, not type_ids — so the distinct types can only be learned by reading rows,
 * and reading page one alone is how a new type stays invisible.
 *
 * Best-effort: a first-page failure returns null rather than taking the route
 * down; a failure part-way keeps what it has and reports truncated. As of
 * 31 Jul 2026 this should return only contact_* types, which are a different job
 * (AML, Right to Rent, NRL) and deliberately out of scope.
 */
async function accountWideUnmappedTypes(): Promise<AccountCensus | null> {
  try {
    const started = Date.now();
    const rows: Array<Record<string, unknown>> = [];
    let truncated = true; // until a short page proves we reached the end
    for (let page = 0; page < CENSUS_PAGE_CEILING; page++) {
      if (Date.now() - started > CENSUS_BUDGET_MS) break;
      const res = await rexCall("ComplianceEntries", "search", {
        criteria: [
          { name: "type_id", type: "notin", value: Object.keys(PROPERTY_COMPLIANCE) },
        ],
        limit: REX_PAGE,
        offset: page * REX_PAGE,
      }).catch(() => null);
      // Nothing at all is a null answer; something then a failure is a partial
      // one, and the difference matters to the verdict.
      if (!res || !res.ok) return rows.length ? await finishCensus(rows, true) : null;
      const batch = rexRows(res.result);
      rows.push(...batch);
      if (batch.length < REX_PAGE) {
        truncated = false;
        break;
      }
    }
    return await finishCensus(rows, truncated);
  } catch {
    return null;
  }
}

/** Distinct types out of the walked rows, each counted properly. */
async function finishCensus(
  rows: Array<Record<string, unknown>>,
  truncated: boolean
): Promise<AccountCensus> {
  const seen = [...new Set(rows.map((r) => String(r.type_id ?? "")))]
    .filter(Boolean)
    .sort();
  const types = await Promise.all(
    seen.map(async (typeId) => {
      const c = await rexCall("ComplianceEntries", "search", {
        criteria: [{ name: "type_id", type: "=", value: typeId }],
        result_format: "ids",
        limit: 1_000_000,
      }).catch(() => null);
      return {
        typeId,
        count: c && c.ok ? rexRows(c.result).length : null,
        contactLevel: typeId.startsWith("contact_"),
      };
    })
  );
  return { types, truncated, rowsWalked: rows.length };
}

interface Target {
  listingId: string;
  propertyId: string;
  name: string;
  locality: string;
  book: "current" | "managed";
  /** The Listings row's own EPC fields — the second, unreconciled EPC source. */
  epcExpiry: string | null;
  epcRating: number | null;
  epcNotRequired: boolean;
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const listingId = params.get("listingId")?.trim() || null;
  const sweep = params.get("all") === "1";
  const book = params.get("book") === "managed" ? "managed" : "current";

  try {
    const rexUserId = await resolveRexUserId(user);
    if (!rexUserId) {
      return NextResponse.json({
        listingId,
        linked: false,
        verdict: "Your REX account isn't linked, so there's nothing to check.",
      });
    }

    const [listings, portfolio] = await Promise.all([
      getAgentListings(rexUserId).catch(() => null),
      getAgentPortfolioProperties(rexUserId).catch(() => null),
    ]);

    // Both books are needed even in single-property mode — that's how we scope
    // the id to this agent, and it's how ?listingId works for a managed
    // property that the Compliance page (current listings only) never shows.
    const current: Target[] = (listings ?? []).map((l) => ({
      listingId: l.id,
      propertyId: l.propertyId,
      name: l.name,
      locality: l.locality,
      book: "current" as const,
      epcExpiry: l.epcExpiry,
      epcRating: l.epcRating,
      epcNotRequired: l.epcNotRequired,
    }));
    const managed: Target[] = (portfolio ?? []).map((p) => ({
      listingId: p.listingId,
      propertyId: p.propertyId,
      name: p.name,
      locality: p.locality,
      book: "managed" as const,
      epcExpiry: p.epcExpiry,
      epcRating: p.epcRating,
      epcNotRequired: p.epcNotRequired,
    }));

    if (listings == null && portfolio == null) {
      return NextResponse.json({
        listingId,
        linked: true,
        booksLoaded: { current: false, managed: false },
        verdict:
          "Couldn't reach REX for your listings at all — nothing below would be meaningful, so nothing was fetched.",
      });
    }

    let targets: Target[];
    let cappedSweep = false;
    if (listingId) {
      targets = [...current, ...managed].filter((t) => t.listingId === listingId);
      if (targets.length === 0) {
        return NextResponse.json(
          { error: "Not one of your properties.", listingId },
          { status: 404 }
        );
      }
    } else if (sweep) {
      const pool = book === "managed" ? managed : current;
      cappedSweep = pool.length > MAX_SWEEP_PROPERTIES;
      targets = pool.slice(0, MAX_SWEEP_PROPERTIES);
    } else {
      return NextResponse.json({
        linked: true,
        booksLoaded: { current: listings != null, managed: portfolio != null },
        currentListings: current.length,
        managedProperties: managed.length,
        verdict:
          "Pass ?listingId=<id> for one property, or ?all=1 to sweep your on-market book (?book=managed for the let book). Ids are in the lists below.",
        yourCurrentListings: current.map((t) => ({
          listingId: t.listingId,
          propertyId: t.propertyId,
          name: t.name,
        })),
        yourManagedProperties: managed.map((t) => ({
          listingId: t.listingId,
          propertyId: t.propertyId,
          name: t.name,
        })),
      });
    }

    // Compliance hangs off the property record, the listing record, or both —
    // ask about both, exactly as production does.
    const ids = [
      ...new Set(targets.flatMap((t) => [t.propertyId, t.listingId]).filter(Boolean)),
    ];
    const [probe, accountUnmapped] = await Promise.all([
      probeCompliance(ids),
      accountWideUnmappedTypes(),
    ]);

    // A parent id can belong to more than one target — two listings on the same
    // property share its property id — so a row is attributed to every target
    // that claims it rather than to whichever happened to be registered last.
    const kindOf = new Map<string, "property" | "listing">();
    const ownersOf = new Map<string, string[]>();
    const claim = (id: string, kind: "property" | "listing", listingId: string) => {
      if (!id) return;
      kindOf.set(id, kind);
      ownersOf.set(id, [...(ownersOf.get(id) ?? []), listingId]);
    };
    for (const t of targets) {
      claim(t.propertyId, "property", t.listingId);
      claim(t.listingId, "listing", t.listingId);
    }
    const parentStats = new Map(probe.perParent.map((p) => [p.parentId, p]));

    const rowsByListing = new Map<string, ComplianceProbeRow[]>();
    for (const row of probe.rows) {
      for (const owner of ownersOf.get(row.parentObjectId) ?? []) {
        const list = rowsByListing.get(owner) ?? [];
        list.push(row);
        rowsByListing.set(owner, list);
      }
    }

    const properties = targets.map((t) => {
      const rows = rowsByListing.get(t.listingId) ?? [];
      const parents = [t.propertyId, t.listingId].filter(Boolean).map((id) => {
        const s = parentStats.get(id);
        return {
          parentId: id,
          is: kindOf.get(id) ?? "unknown",
          rowsReturned: s?.rowsReturned ?? 0,
          pages: s?.pages ?? 0,
          capped: s?.capped ?? false,
          failed: s?.failed ?? true,
        };
      });

      const seen = new Set(rows.map((r) => r.typeId));
      // True only when every parent came back complete. Everything below that
      // reads an ABSENCE off `rows` has to be gated on it: a row we found is a
      // fact either way, a row we didn't find is only a fact once REX finished.
      const completeAnswer = parents.every((p) => !p.failed && !p.capped);
      // EPC lives in two places REX never reconciles: the Listings row's own
      // epc_expiry_date (what My Properties shows) and the EPC ComplianceEntry
      // (what Compliance shows). If they disagree the portal prints two
      // different dates in two tabs and flags neither.
      const epcEntry = rows.find((r) => r.typeId === "epc") ?? null;

      return {
        listingId: t.listingId,
        propertyId: t.propertyId,
        name: t.name,
        locality: t.locality,
        book: t.book,
        parents,
        completeAnswer,
        entriesFound: rows.length,
        recognised: rows.filter((r) => r.mapped).length,
        dropped: rows.filter((r) => !r.mapped).map((r) => r.typeId),
        // Absent = REX genuinely holds no entry of this type on either parent.
        // Only meaningful when completeAnswer is true.
        absentExpectedTypes: EXPECTED_TYPES.filter((k) => !seen.has(k)),
        epcCrossCheck: {
          listingRow: {
            expiry: t.epcExpiry,
            rating: t.epcRating,
            notRequired: t.epcNotRequired,
          },
          complianceEntry: epcEntry
            ? { expiry: epcEntry.expiryDate, issued: epcEntry.issueDate, state: epcEntry.derivedState }
            : null,
          /**
           * A null complianceEntry means "REX holds none" ONLY when this is
           * true; otherwise it means "we never got to see one", which is a
           * different claim entirely.
           */
          entryAbsenceIsReal: epcEntry == null ? completeAnswer : null,
          agrees:
            epcEntry == null
              ? null
              : String(t.epcExpiry ?? "") === String(epcEntry.expiryDate ?? ""),
          // Measured 31 Jul 2026 on 40 leased listings: 30 had an EPC date on
          // the listing row and NO EPC compliance entry at all. The Compliance
          // page reads only the entry, so for those it shows nothing while My
          // Properties shows a perfectly good date. This names that case — but
          // only when REX finished answering, because a short read produces the
          // identical-looking null and naming it an absence would be a lie.
          note: epcEntry
            ? String(t.epcExpiry ?? "") === String(epcEntry.expiryDate ?? "")
              ? "Both sources agree."
              : "The two EPC sources disagree — the portal shows both, in different tabs, and reconciles neither."
            : !completeAnswer
              ? "Couldn't tell: REX's answer for this property was cut short, so no EPC entry came back — which is not the same as there being none."
              : t.epcExpiry
                ? "The listing row holds an EPC expiry but there is NO EPC compliance entry — Compliance shows nothing, My Properties shows the date."
                : "No EPC anywhere: no compliance entry and no date on the listing row.",
        },
        // Raw, unparsed, exactly as REX sent them — this is the bit to eyeball.
        entries: rows,
      };
    });

    // Every raw type_id REX returned, so the 14 literals in PROPERTY_COMPLIANCE
    // can finally be checked against the account instead of trusted. An id in
    // `unrecognised` has been invisible on the Compliance page since day one.
    const counts = new Map<string, number>();
    for (const r of probe.rows) counts.set(r.typeId, (counts.get(r.typeId) ?? 0) + 1);
    const census = [...counts.entries()]
      .map(([typeId, count]) => ({
        typeId,
        count,
        label: PROPERTY_COMPLIANCE[typeId] ?? null,
      }))
      .sort((a, b) => b.count - a.count || a.typeId.localeCompare(b.typeId));
    const unrecognised = census.filter((c) => c.label == null);

    const truncated = properties.filter((p) => !p.completeAnswer);
    const missingExpected = properties.filter(
      (p) => p.completeAnswer && p.absentExpectedTypes.length > 0
    );
    const unreadableDates = probe.rows.filter((r) => r.expiryParses === false);
    const epcDisagrees = properties.filter((p) => p.epcCrossCheck.agrees === false);
    // The common case, and the one nobody would guess: the EPC is on the
    // listing record only, so the Compliance page never sees it. Complete reads
    // only — on a short read the missing entry may simply not have arrived.
    const epcOnListingOnly = properties.filter(
      (p) =>
        p.completeAnswer &&
        p.epcCrossCheck.complianceEntry == null &&
        p.epcCrossCheck.listingRow.expiry
    );

    // Contact-level types (AML, Right to Rent, NRL) are dropped on purpose —
    // different job. Only a PROPERTY type falling through is a problem.
    const droppedPropertyTypes = (accountUnmapped?.types ?? []).filter(
      (t) => !t.contactLevel
    );
    // The census is the evidence behind droppedPropertyTypes. If it didn't
    // finish, an empty droppedPropertyTypes proves nothing.
    const censusIncomplete = accountUnmapped == null || accountUnmapped.truncated;

    // The failure modes in the order they matter: an incomplete read first,
    // because nothing after it can be trusted; then data we dropped; then data
    // we misread; then genuine absence; then the two-sources problem. First one
    // that fires is the answer.
    const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
    const verdict =
      [
        // Ahead of everything else: the earlier bail only fires when BOTH books
        // fail, so one failed book (or a sweep over an empty pool) reaches here
        // with an empty `properties` — where every term below measures an empty
        // array, comes back falsy, and hands the all-clear to a book nobody read.
        (listings == null || portfolio == null) &&
          `INCOMPLETE: couldn't load your ${
            listings == null ? "on-market" : "managed"
          } book from REX at all, so nothing below covers it.`,
        properties.length === 0 &&
          "No properties were probed, so nothing below is an all-clear — check booksLoaded and the ids above.",
        truncated.length &&
          `TRUNCATED: ${truncated.length} of ${properties.length} ${plural(
            truncated.length,
            "property",
            "properties"
          )} came back short or failed, so anything reading ALL CLEAR for them is unverified.`,
        droppedPropertyTypes.length &&
          `REX holds ${droppedPropertyTypes.length} property certificate ${plural(
            droppedPropertyTypes.length,
            "type",
            "types"
          )} the portal doesn't recognise (${droppedPropertyTypes
            .map((t) => `${t.typeId}${t.count == null ? "" : ` ×${t.count}`}`)
            .join(", ")}) — add them to PROPERTY_COMPLIANCE or they stay invisible.`,
        unrecognised.length &&
          `REX returned ${unrecognised.length} entry ${plural(
            unrecognised.length,
            "type",
            "types"
          )} on your own properties that the portal doesn't recognise (${unrecognised
            .map((c) => c.typeId)
            .join(", ")}) — they're dropped before you see them.`,
        unreadableDates.length &&
          `${unreadableDates.length} ${plural(
            unreadableDates.length,
            "entry has",
            "entries have"
          )} an expiry date we can't read, so they can't be trusted as in-date.`,
        epcOnListingOnly.length &&
          `${epcOnListingOnly.length} ${plural(
            epcOnListingOnly.length,
            "property has",
            "properties have"
          )} an EPC date on the listing record but no EPC compliance entry — Compliance shows nothing for them while My Properties shows the date. Two separate fields in REX, not a fetch problem.`,
        missingExpected.length &&
          `REX holds no record at all of ${[
            ...new Set(missingExpected.flatMap((p) => p.absentExpectedTypes)),
          ].join("/")} for ${missingExpected.length} ${plural(
            missingExpected.length,
            "property",
            "properties"
          )} — genuinely absent in REX, not a fetch problem.`,
        epcDisagrees.length &&
          `Everything came through, but the listing's own EPC date and the EPC compliance entry disagree on ${
            epcDisagrees.length
          } ${plural(epcDisagrees.length, "property", "properties")}.`,
        // Last, because it only matters once nothing else fired — and it has to
        // fire, because the all-clear below would otherwise be read off a census
        // that never finished counting.
        censusIncomplete &&
          `Nothing fired on your own properties, but the account-wide type census ${
            accountUnmapped == null
              ? "couldn't be run at all"
              : `stopped after ${accountUnmapped.rowsWalked} rows`
          } — a certificate type the portal drops could still be sitting past where it stopped. Not an all-clear.`,
      ].find((m): m is string => typeof m === "string") ??
      "Everything REX holds for these properties is on the page.";

    return NextResponse.json({
      linked: true,
      booksLoaded: { current: listings != null, managed: portfolio != null },
      scope: {
        mode: listingId ? "one property" : `sweep (${book})`,
        propertiesProbed: properties.length,
        parentIdsProbed: ids.length,
        cappedSweep,
        note: cappedSweep
          ? `Capped at ${MAX_SWEEP_PROPERTIES} properties so the route returns — re-run with ?listingId for the rest.`
          : null,
      },

      // The measurement: the same question, asked both ways.
      productionShape: probe.productionShape,
      // entriesLost is clamped at 0 (rex-stats), so a per-id read that failed or
      // capped part-way makes the TRUTH side the short one and the gap vanishes.
      // A zero gap is only an all-clear when both sides finished — otherwise say
      // the measurement couldn't be taken rather than that it came back clean.
      truncationVerdict: probe.perParent.some((p) => p.failed || p.capped)
        ? "Can't measure: the per-id read this comparison is judged against was itself cut short, so a zero gap proves nothing."
        : probe.productionShape.chunks.some((c) => c.failed)
          ? "Can't measure: a batched chunk failed outright, so the row gap is a failure, not truncation."
          : probe.productionShape.entriesLost > 0
            ? `The batched call the pages use returned ${probe.productionShape.entriesLost} fewer rows than reading each id properly. Those rows are missing from the Compliance page right now.`
            : "The batched call the pages use returned the same rows as reading each id properly — no truncation on this book today.",

      typeIdCensus: { all: census, unrecognised },
      // The same question at business scale. Anything in `types` that ISN'T
      // contactLevel is a property certificate type falling on the floor —
      // and `truncated` says whether that list is a total or a floor.
      accountWideUnmappedTypes: accountUnmapped,
      expectedTypesChecked: EXPECTED_TYPES,
      properties,

      verdict,
    });
  } catch (e) {
    // A blank page is the least useful failure there is — a debug route that
    // dies silently is worse than no debug route.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), listingId },
      { status: 500 }
    );
  }
}
