"use client";

// /recruitment — a standalone pitch to experienced letting agents.
//
// Deliberately NOT linked from anywhere: no nav entry, no footer link, no
// sitemap. It is a page you send someone, not one they stumble into.
//
// The copy is the live join.thelettingexperts.co.uk content, re-set in the TLE
// OS design language rather than rewritten: same eggshell canvas, white cards,
// hairline borders, red accent, doodle icons and Notioly figures the dashboard
// uses. The point of the exercise is to prove the OS style travels to a
// marketing surface — so nothing here invents a new palette or a new card.
//
// Handwritten headings (.hand → Shantell Sans) are used far more than the
// dashboard does. That is the one deliberate departure: the dashboard is a tool
// people read all day, this is a page somebody reads once, and it is allowed to
// have a voice.

import { useEffect, useRef, useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";
import Reveal from "./Reveal";
import HousesScene from "@/components/HousesScene";
import Scribble from "./Scribble";

/* ------------------------------ the content ------------------------------ */

const LOVE = [
  { icon: "clock", text: "Flexible working hours built around your family & lifestyle" },
  { icon: "coin", text: "A higher income to support the lifestyle you strive toward" },
  { icon: "target", text: "Control of your own destiny: working how you want" },
  { icon: "star", text: "A better quality of life that nurtures your health & wellbeing" },
];

const PERSONAS = [
  {
    art: "/illustrations/notioly/fast-worker.svg",
    title: "The employed agent",
    body: "Working hard every day to build someone else's business. Undervalued, capped on what you can earn, and quietly certain you'd do it better if it were yours.",
  },
  {
    art: "/illustrations/notioly/lost-the-way.svg",
    title: "The self-employed agent",
    body: "You made the leap — but the brand behind you didn't. No real support, no proper tools, nobody in your corner when it gets hard. It shouldn't feel this alone.",
  },
  {
    art: "/illustrations/notioly/moving.svg",
    title: "The career changer",
    body: "Years of sales, service and graft in somebody else's industry, and a growing feeling it's time all of that started paying you instead.",
  },
];

/**
 * The bento: the collage's geometry carrying the "what we give you" content.
 * Nine tiles — mirrored long tiles top and bottom, two talls flanking the
 * Mist title tile in the centre. Size dictates voice: talls and longs carry a
 * description over the artwork, smalls just name the thing. The old nine-item
 * list became eight by merging the two marketing entries, which were one
 * promise wearing two hats.
 */
type BentoTile = {
  art: string;
  title: string;
  body?: string;
  span: string;
  /** which OUTSIDE edge of the frame the pointer arrow sits on */
  edge: "top" | "bottom" | "left" | "right";
};
const BENTO: (BentoTile | { title: string; centre: true; span: string })[] = [
  {
    art: "/illustrations/notioly/accomplishment.svg",
    title: "Training & accountability",
    body: "A step-by-step Success Blueprint, and a coach who holds you to it.",
    span: "",
    edge: "top",
  },
  {
    art: "/illustrations/notioly/tasks.svg",
    title: "Industry-leading tools",
    body: "A CRM built for self-employed agents, lead gen, and platforms that cut the admin.",
    span: "col-span-2",
    edge: "top",
  },
  {
    art: "/illustrations/notioly/checklist.svg",
    title: "Legislation, handled",
    body: "Training that keeps you current and your portfolio compliant.",
    span: "",
    edge: "top",
  },
  {
    art: "/illustrations/notioly/buildings.svg",
    title: "No postcode restrictions",
    body: "Any property, any location, any price range. No carve-ups, no territories.",
    span: "row-span-2",
    edge: "left",
  },
  { title: "Everything you need to be dangerous", centre: true, span: "col-span-2 row-span-2" },
  {
    art: "/illustrations/notioly/growth.svg",
    title: "Marketing, done with you",
    body: "A dedicated team building assets you personalise — for your brand, not ours.",
    span: "row-span-2",
    edge: "right",
  },
  {
    art: "/illustrations/notioly/reminder.svg",
    title: "Compliance support team",
    body: "Pre-tenancy, move-ins and rent collection handled, so you do the income work.",
    span: "col-span-2",
    edge: "left",
  },
  {
    art: "/illustrations/notioly/png/social-acceptance.png",
    title: "Your own success coach",
    body: "One person whose whole job is your success — admin to pipeline.",
    span: "",
    edge: "bottom",
  },
  {
    art: "/illustrations/notioly/piggy-bank.svg",
    title: "Portfolio building",
    body: "The blueprint for a management book that pays you every month.",
    span: "",
    edge: "right",
  },
];

const GIVES_YOU = [
  { word: "Time", body: "Set your own schedule around your life. Never again miss out on time with family and friends." },
  { word: "Money", body: "Unlimited earning potential — the family home, the car, the bucket-list holidays." },
  { word: "Freedom", body: "Work from wherever you need, or want. Not confined to a physical office." },
  { word: "Satisfaction", body: "Build something you're proud of, that also gives back to your community." },
];

const STEPS = [
  ["Suitability quiz", "A very short quiz to make sure this is the right opportunity for you."],
  ["The info pack", "Everything you need to know about joining as a self-employed letting agent."],
  ["The video vault", "A series of short videos on what success actually looks like here."],
  ["Discovery call", "We find out about you, answer your questions, and see if the model fits."],
  ["Meet Susan", "Go through the finer details with the Managing Director — and talk to other Letting Experts."],
  ["Licence agreement", "If everyone's happy, we issue your agreement and the set-up fee instructions."],
  ["Onboarding", "The Agent Support Team start the onboarding and compliance process."],
  ["Induction training", "An intensive 5-day online programme to launch your business."],
  ["CELA certification", "Your formal Level 3 Certificate for Estate and Lettings Agents."],
  ["Launch", "All the tools, tech and support you need to start winning listings."],
];

const VOICES = [
  {
    head: "Fresh & modern approach",
    quote:
      "I can provide a personable and collaborative service to my clients without compromising on standards, accountability, compliance and security.",
    who: "Dan Richards",
    where: "Wolverhampton",
  },
  {
    head: "Exceptional support",
    quote:
      "The combination of industry-leading software and ongoing support allows my business to grow and ensures my landlords are compliant at all times.",
    who: "Rhiannon Dodge",
    where: "Teignbridge & Torbay",
  },
  {
    head: "A commitment to excellence",
    quote:
      "The customer-first mindset aligns perfectly with my values and high standards — exactly what I need to make a meaningful impact in the industry.",
    who: "James Crumpton",
    where: "Bristol",
  },
  {
    head: "Absolute game changer",
    quote:
      "I've always had a passion for lettings. This model lets me run my own business and provide exceptional service without compromising on family life.",
    who: "Bernadine Williams",
    where: "Herts & Beds",
  },
];

const FAQS = [
  ["Is there a salary?", "No. This is a business opportunity, not a job. You'll be starting your own business."],
  [
    "How do I generate leads?",
    "The Success Blueprint is a step-by-step guide with proven systems and strategies, and you'll have a dedicated Success Coach who holds you accountable.",
  ],
  [
    "Am I limited to an area?",
    "No restriction on areas — you can let a property in any location. You just need to know the area and be close enough to do appointments and manage properly.",
  ],
  [
    "Do I need letting agency experience?",
    "A minimum of 2 years. Lettings legislation knowledge, great marketing and excellent service are the skills that matter here.",
  ],
  [
    "Is there any training?",
    "Yes — a 5-day induction, ongoing online training and in-person events. Full training in every aspect.",
  ],
];

const VALUES = [
  ["We love what we do", "Passion and enthusiasm every day. A can-do attitude, some fun, and a smile."],
  ["We take responsibility", "We own our business and what happens in it. The buck stops with us."],
  ["We care about relationships", "Clients, colleagues, community, environment — and our own wellbeing."],
  ["We commit to personal progress", "Constantly improving, expanding knowledge, becoming trusted advisors."],
  ["We get s**t done", "Clear goals, action every day. Proactive, and focused on outstanding results."],
];

/* -------------------------------- sections ------------------------------- */

function SectionHead({
  kicker,
  title,
  blurb,
  className = "",
}: {
  kicker: string;
  title: React.ReactNode;
  blurb?: string;
  className?: string;
}) {
  return (
    <div className={`mx-auto max-w-2xl text-center ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] accent-text">
        {kicker}
      </span>
      <h2
        className="written mt-3 tracking-tight"
        style={{ fontSize: "clamp(30px, 4vw, 46px)", lineHeight: 1.08 }}
      >
        {title}
      </h2>
      {blurb ? <p className="mt-3 text-[14px] leading-relaxed text-muted">{blurb}</p> : null}
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-5 py-4 text-left"
      >
        <span className="flex-1 text-[15px] font-medium">{q}</span>
        <span
          className="shrink-0 text-[20px] leading-none text-muted transition-transform duration-200"
          style={{ transform: open ? "rotate(45deg)" : "none" }}
        >
          +
        </span>
      </button>
      {/* Grid-rows trick: animates to the content's real height without
          measuring it, and without a max-height guess that clips long answers. */}
      <div
        className="grid transition-all duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-[14px] leading-relaxed text-muted">{a}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Probe for the Higgsfield loop. Lifted out of the old HeroVisual component
 * because the TITLE now needs to know whether the video exists — the balloon
 * in the footage stands in for the O of "OF LETTINGS", so the h1 itself
 * renders differently with and without it.
 *
 * HEAD + content-type, not just r.ok: Next's dev server answers HEAD for
 * MISSING files with 200 text/html.
 */
function useHeroLoop(): string | null {
  const [loop, setLoop] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const src of ["/illustrations/hero-loop.webm", "/illustrations/hero-loop.mp4"]) {
        try {
          const r = await fetch(src, { method: "HEAD" });
          const type = r.headers.get("content-type") ?? "";
          if (r.ok && type.startsWith("video/")) {
            if (!cancelled) setLoop(src);
            return;
          }
        } catch {
          /* keep looking */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return loop;
}

/**
 * The search line at the foot of the hero — an underline, not a box, matching
 * the reference. It searches THIS page: the query is matched against a small
 * keyword index plus the FAQ copy, and the page scrolls to the best answer.
 * No backend, nothing pretending to be a document search that isn't — when
 * nothing matches it goes to the FAQs, which is where an unanswerable question
 * belongs.
 */
function HeroSearch() {
  const [q, setQ] = useState("");

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim().toLowerCase();
    if (!t) return; // an empty search scrolling the page is a jump scare, not help
    const INDEX: Array<[RegExp, string]> = [
      [/earn|money|salary|income|commission|fee|pay/, "faqs"],
      [/train|coach|support|tool|tech|crm|market|lead|blueprint/, "give"],
      [/who|for me|employed|career|change/, "who"],
      [/step|process|join|start|how|quiz|onboard/, "how"],
      [/susan|founder|who runs|director/, "founder"],
    ];
    const hit =
      INDEX.find(([re]) => re.test(t))?.[1] ??
      (FAQS.some(([fq, fa]) => (fq + " " + fa).toLowerCase().includes(t)) ? "faqs" : "faqs");
    document.getElementById(hit)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <form onSubmit={go} className="mt-5 flex items-end gap-3">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Search this page</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="What do you want to know?"
          className="w-full border-b border-ink/50 bg-transparent pb-1.5 text-[13.5px] text-ink placeholder:text-ink/50 focus:border-ink focus:outline-none"
        />
      </label>
      <button type="submit" className="cta cta-dark shrink-0 rounded-none px-4 py-2 text-[12.5px] font-semibold">
        Search
      </button>
    </form>
  );
}

/**
 * The hero closes down as you scroll — a CURTAIN, not a compression: the
 * canvas's visible window narrows from both edges (clip-path inset) while the
 * artwork underneath keeps its exact aspect, so the words are cut off rather
 * than squashed. The nav rides the collapsing top edge down as though it were
 * scrolling with it, and the next section is pulled up over the runway's tail
 * so it is already arriving while the curtain closes.
 *
 * Plain scroll + rAF rather than a scroll-timeline animation: this has to
 * work in every browser an agent might open the link in, and the CSS
 * scroll-driven API still doesn't. Writes happen inside requestAnimationFrame
 * so a fast trackpad can't queue up layout work.
 *
 * Under prefers-reduced-motion the whole mechanism stands down: no runway, no
 * pin, no transform — the page is just a page.
 */
function useCollapseOnScroll() {
  const runwayRef = useRef<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setEnabled(false);
      return;
    }
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const sec = runwayRef.current;
        const box = boxRef.current;
        const nav = navRef.current;
        if (!sec || !box) return;
        const runway = sec.offsetHeight - window.innerHeight;
        if (runway <= 0) return;
        const p = Math.min(1, Math.max(0, -sec.getBoundingClientRect().top / runway));
        // Ease-in: barely moves at first, then commits to the collapse.
        const open = Math.max(0, 1 - p * p);
        // CROP, not squash: the content keeps its exact aspect and the canvas
        // closes over it from both edges — a curtain, not a compression. A
        // clip-path leaves layout and the artwork untouched; only the visible
        // window narrows to a stripe and fades.
        const inset = ((1 - open) / 2) * box.offsetHeight;
        box.style.clipPath = `inset(${inset}px 0 ${inset}px 0)`;
        box.style.opacity = p > 0.9 ? String(Math.max(0, (1 - p) / 0.1)) : "1";
        // The nav rides the collapsing top edge down, as if scrolling with it.
        if (nav) nav.style.transform = `translateY(${inset}px)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return { runwayRef, boxRef, navRef, enabled };
}

/* ---------------------------------- page --------------------------------- */

export default function RecruitmentPage() {
  const QUIZ = "https://join.thelettingexperts.co.uk/join-us";
  const loop = useHeroLoop();
  const { runwayRef, boxRef, navRef, enabled: collapse } = useCollapseOnScroll();

  // Which bento tile is hot, and where the outside arrow should sit.
  const bentoWrapRef = useRef<HTMLDivElement | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const [hotPos, setHotPos] = useState<{ edge: "top" | "bottom" | "left" | "right"; at: number } | null>(null);
  const pointAt = (i: number, el: HTMLElement) => {
    setHot(i);
    const wrap = bentoWrapRef.current;
    const tile = BENTO[i];
    if (!wrap || !("edge" in tile)) return;
    const r = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    // `at` is the coordinate ALONG the chosen edge: y for the sides, x for
    // top and bottom — each tile declares which edge its pointer lives on.
    setHotPos({
      edge: tile.edge,
      at:
        tile.edge === "left" || tile.edge === "right"
          ? r.top - w.top + r.height / 2
          : r.left - w.left + r.width / 2,
    });
  };

  // The handwriting entrance fires once, when the heading scrolls into view.
  const writeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = writeRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          el.classList.add("in-view");
          io.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="outline-cards soft-cards min-h-screen bg-page">
      {/* ---------------- nav ---------------- */}
      {/* ---------------- hero ---------------- */}
      {/* Nav lives OUTSIDE the clay now, on the page's own eggshell, with room
          to breathe — the clay is a full-width rectangle below it, running to
          the bottom corners with only the padding gutter. Monochrome-plus-clay
          is the whole premise: black type, black linework, and the Warm Clay
          (#DE968F) shining through. The red returns further down the page. */}
      <section ref={runwayRef} className="relative" style={{ height: collapse ? "180vh" : "auto" }}>
        <div
          className={`${collapse ? "sticky top-0 z-0 h-screen" : "min-h-screen"} flex flex-col px-5 pb-5 sm:px-8 sm:pb-8`}
        >
        {/* nav, on the page background */}
        <div ref={navRef} className="flex items-center justify-between px-1 py-6 will-change-transform sm:px-2 sm:py-8">
          <span className="written text-[15px] leading-[0.95] tracking-tight text-ink sm:text-[17px]">
            The
            <br />
            Letting
            <br />
            Experts
          </span>
          {/* A square box, as asked — the one deliberately un-rounded element
              on a site of pills and rounded cards, which is what makes it read
              as a button-you-press rather than another chip. */}
          <a href={QUIZ} className="cta cta-dark rounded-none px-5 py-2.5 text-[13px] font-semibold">
            Join Now
          </a>
        </div>

        {/* the clay rectangle — boxRef is what the scroll collapse scales */}
        <div ref={boxRef} className="relative flex flex-1 flex-col overflow-hidden bg-[#DE968F] will-change-transform">
          <div className="relative flex flex-1 flex-col px-4 pb-8 sm:px-8">
            {/* Reference treatment: huge, heavy, tight. "THE FUTURE" runs the
                full width; "OF LETTINGS" starts padded in on the left rather
                than stretching to fit — the stagger is the composition, and it
                spares us a single line that would never have fitted. */}
            {/* The staircase at full, EQUAL weight — both lines the same size,
                line two right-flush so it runs to the end of the screen.
                "Lettings" swaps to the handwritten face inside the same line:
                the one word the brand owns, in the hand the OS writes with.
                Base size is tuned to the WIDER second line; measured, not
                guessed. */}
            <h1
              className="mt-8 text-left font-black uppercase text-ink sm:mt-10"
              style={{ fontSize: "clamp(40px, min(11.4vw, 18vh), 184px)", lineHeight: 0.85, letterSpacing: "-0.05em" }}
            >
              <span className="block whitespace-nowrap">The Future</span>
              {loop ? (
                /* The balloon IS the O. All geometry in em so it scales with
                   the type. Balloon centre sits at (35.9%, 28%) of the frame at
                   22.6% frame-width diameter — measured from the RENDERED
                   element, because the first numbers came from a raw-frame scan
                   that caught the motion streaks and put the balloon a fifth of
                   an em off its slot. A 3.54em video puts a 0.80em balloon
                   in the O's gap — sized a shade over the cap height, because
                   a fine-lined circle needs extra diameter to carry the same
                   visual mass as the black caps beside it; the lady dangles from the headline
                   into the canvas. 0.75 speed as asked. Screen readers still
                   hear "of Lettings". */
                <span className="relative block whitespace-nowrap text-right">
                  <span aria-hidden className="relative inline-block h-0" style={{ width: "0.8em" }}>
                    <video
                      ref={(el) => {
                        if (el) el.playbackRate = 0.75;
                      }}
                      src={loop}
                      autoPlay
                      muted
                      loop
                      playsInline
                      aria-hidden
                      className="pointer-events-none absolute max-w-none mix-blend-multiply"
                      // brightness clips the export's 254-white to true 255
                      // before the blend — without it, multiply leaves a 0.4%
                      // ghost rectangle you can just see against flat clay.
                      style={{ width: "3.54em", left: "-0.87em", top: "-1.06em", filter: "brightness(1.04)" }}
                    />
                  </span>
                  <span className="sr-only">O</span>f <span className="written">Lettings</span>
                </span>
              ) : (
                <span className="block whitespace-nowrap text-right">
                  of <span className="written">Lettings</span>
                </span>
              )}
            </h1>

            {/* NO z-index here: a z-indexed wrapper is a stacking context, and
                a stacking context ISOLATES mix-blend-mode — the video's multiply
                would blend against the wrapper's transparency instead of the
                clay, leaving the white box this exists to remove. */}
            {loop ? null : (
              <div className="relative mx-auto mt-auto w-[min(760px,94%)] lg:-mt-[7vw] lg:w-[min(900px,74%)]">
                <div className="relative mx-auto w-[86%] lg:w-[64%]">
                  <Scribble name="sparkles" className="page-art-pulse -right-6 top-[6%] h-14 w-14 text-ink/60 sm:h-16 sm:w-16" />
                  <Scribble name="wind" className="-left-8 top-[38%] hidden h-12 w-12 -scale-x-100 text-ink/40 sm:block" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/illustrations/notioly/png/mailbox-full.png"
                    alt=""
                    aria-hidden
                    className="page-art-float block w-full"
                  />
                </div>
                <p className="pointer-events-none mt-1 pb-1 text-center text-[12.5px] tracking-wide text-ink/70">
                  [ For agents with 2+ years in lettings ]
                </p>
              </div>
            )}

            {/* right column: the pitch, and the search line across the bottom */}
            <div className="mx-auto mt-8 w-full max-w-[44ch] text-center lg:absolute lg:right-10 lg:top-[56%] lg:mt-0 lg:w-[320px] lg:max-w-none lg:text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">About</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/80">
                You already know how to let and manage property. This is the model
                that lets you do it for yourself — your own business, with the
                tools, training and support team behind you.
              </p>
              <HeroSearch />
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* ---------------- who this is for ---------------- */}
      {/* Three people, not a lecture: the reader should find themselves in one
          of these boxes within a scroll. Each carries its own Notioly figure —
          the employed agent on the treadmill, the self-employed one without a
          map, the career changer mid-move. */}
      {/* Pulled up over the collapse's tail (-20vh): by the time the curtain
          is a stripe this section is already climbing the viewport — no dead
          eggshell between the hero and the people it's for. */}
      <section id="who" className="relative z-10 -mt-[34vh] scroll-mt-6 px-5 pb-24 pt-4 sm:px-8">
        <Scribble name="swoosh" className="right-[4%] top-[9%] hidden h-24 w-24 xl:block" />
        {/* Full width at the hero's own gutter — the heading runs from the
            same left edge the canvas does, using the whole line. */}
        <div>
          <Reveal>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] accent-text">
                Who this is for
              </span>
              <h2
                className="written mt-3 tracking-tight"
                style={{ fontSize: "clamp(32px, 4.6vw, 58px)", lineHeight: 1.02 }}
              >
                You&rsquo;ll recognise yourself here
              </h2>
              <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-muted">
                The model is built for people who already know lettings — or know
                how to graft — and want the next chapter to be their own.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PERSONAS.map((who, i) => (
              <Reveal key={who.title} delay={60 + i * 60}>
                <div className="flex h-full flex-col rounded-2xl border border-line p-7">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={who.art} alt="" aria-hidden className="mx-auto h-40 w-auto" />
                  <h3 className="mt-5 text-[16px] font-semibold">{who.title}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{who.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-2xl bg-ink p-7 text-white sm:flex-row sm:items-center">
              <p className="written text-[20px] leading-snug sm:text-[24px]">
                &ldquo;Everyone deserves to live their best life.&rdquo;
              </p>
              <p className="shrink-0 text-[12.5px] text-white/70">
                Sean Newman · Founder, The Experts Group
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- the company we keep ---------------- */}
      {/* The Letting Game reference, inverted: image LEFT, words RIGHT, and a
          scribble arrow doing the pointing back at the picture. Stock stand-in
          until James's own shots arrive — the Mist plate behind it holds the
          composition even if the image dies. */}
      <section className="px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-[1340px] items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <Reveal>
            <div className="relative">
              <div aria-hidden className="absolute -left-3 -top-3 h-full w-full bg-[#FFE4DF]" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1400&q=75&fit=crop"
                alt="The team at work"
                loading="lazy"
                className="relative aspect-[4/3] w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="relative">
              {/* the pointer, sending the reader back to the picture */}
              <Scribble
                name="arrow"
                className="hero-arrow -left-2 top-1/2 hidden h-14 w-14 -scale-x-100 rotate-[15deg] lg:block xl:-left-10"
              />
              <div className="lg:pl-14 xl:pl-16">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] accent-text">
                  The company you&rsquo;ll keep
                </span>
                <h2
                  className="written mt-3 tracking-tight"
                  style={{ fontSize: "clamp(30px, 4vw, 50px)", lineHeight: 1.05 }}
                >
                  Working with the best in the industry
                </h2>
                <p className="mt-5 text-[15px] leading-relaxed text-muted">
                  We&rsquo;re leading the charge in lettings — changing how it&rsquo;s
                  going to be done, with a technology-and-people-first approach
                  that makes the whole experience smooth for everyone in it.
                </p>
                <p className="mt-4 text-[15px] leading-relaxed text-muted">
                  For you, that means every tool at your fingertips and a support
                  team behind you — so the admin runs itself, and your time goes
                  on the parts of the job you actually enjoy.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- the bento: what we give you ---------------- */}
      {/* The collage's black-grout geometry, carrying the give-you content:
          white tiles, ink illustrations, the section title in the centre on
          Mist where the wordmark used to sit. Inset so the eggshell flows
          around it; the frame's padding equals the internal gap (12px), one
          grout line to the outer edge. Rows are viewport-scaled so the whole
          board reads at roughly three-quarters of a screen. */}
      <section id="give" className="scroll-mt-6 px-5 py-10 sm:px-8">
        <div ref={bentoWrapRef} className="relative mx-auto max-w-[1340px]">
          {/* The pointer outside the frame, gliding to whichever tile is hot.
              Driven by state rather than :hover so touch works on first tap
              and the behaviour is testable. Hidden below lg — there is no
              outside-the-frame on a phone. */}
          {hot !== null && hotPos ? (
            <Scribble
              name="arrow"
              className={`pointer-events-none z-10 hidden h-9 w-9 text-ink transition-[top,left] duration-300 lg:block ${
                {
                  left: "-left-12 rotate-[20deg]",
                  right: "-right-12 -scale-x-100 rotate-[20deg]",
                  top: "-top-12 rotate-[135deg]",
                  bottom: "-bottom-12 -rotate-45",
                }[hotPos.edge]
              }`}
              style={
                hotPos.edge === "left" || hotPos.edge === "right"
                  ? { position: "absolute", top: hotPos.at - 18 }
                  : { position: "absolute", left: hotPos.at - 18 }
              }
            />
          ) : null}

          <div className="bg-[#141414] p-2">
            <div className="grid auto-rows-[clamp(135px,18vh,200px)] grid-cols-2 gap-2 md:grid-cols-4">
              {BENTO.map((tile, i) =>
                "centre" in tile ? (
                  <div
                    key={i}
                    className={`flex items-center justify-center bg-[#DE968F] p-6 ${tile.span}`}
                  >
                    <p className="written max-w-[14ch] text-center text-[clamp(24px,2.8vw,40px)] leading-[1.05] text-ink">
                      {tile.title}
                    </p>
                  </div>
                ) : (
                  <figure
                    key={i}
                    onMouseEnter={(e) => pointAt(i, e.currentTarget)}
                    onMouseLeave={() => setHot(null)}
                    className={`relative overflow-hidden transition-colors duration-300 ${
                      hot === i ? "bg-[#DE968F]" : "bg-[#FFE4DF]"
                    } ${tile.span}`}
                  >
                    {/* resting face: figure + name. On hover it FALLS — art and
                        title drop off the bottom of the tile together. */}
                    <div
                      className={`absolute inset-0 flex flex-col p-4 transition-all duration-300 ${
                        hot === i ? "translate-y-[115%] opacity-0" : "translate-y-0 opacity-100"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={tile.art} alt="" aria-hidden className="min-h-0 flex-1 object-contain" />
                      <figcaption className="pt-2 text-center text-[13px] font-bold leading-tight">
                        {tile.title}
                      </figcaption>
                    </div>
                    {/* revealed face: the words fall IN from above as the art
                        falls out below — one motion handing to the other. */}
                    <div
                      className={`absolute inset-0 flex flex-col justify-center p-5 transition-all duration-300 ${
                        hot === i ? "translate-y-0 opacity-100" : "-translate-y-[35%] opacity-0"
                      }`}
                    >
                      <p className="text-[15px] font-bold leading-tight">{tile.title}</p>
                      {tile.body ? (
                        <p className="mt-1.5 max-w-[36ch] text-[12.5px] leading-relaxed text-ink/75">{tile.body}</p>
                      ) : null}
                    </div>
                  </figure>
                )
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- what it gives you ---------------- */}
      <section className="relative px-6 py-24">
        <Scribble name="arrow" className="left-[6%] top-[10%] hidden h-20 w-20 lg:block" />
        <Reveal>
        {/* The heading writes itself in when it arrives: each line is
            revealed left-to-right as though a pen were crossing it, and then —
            the going-back — a stroke underscores "own". The extra line-height
            keeps that stroke out of the second line's way. */}
        <div ref={writeRef} className="write-on-scroll mx-auto max-w-3xl text-center">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] accent-text">
            What you get out
          </span>
          <h2
            className="written mt-3 tracking-tight"
            style={{ fontSize: "clamp(30px, 4vw, 46px)", lineHeight: 1.35 }}
          >
            <span className="write-line write-line-1 inline-block">
              Building your{" "}
              <span className="relative inline-block">
                own
                <svg
                  viewBox="0 0 120 14"
                  aria-hidden
                  className="own-underline absolute -bottom-[0.16em] left-0 h-[0.28em] w-full overflow-visible"
                >
                  <path
                    d="M4 9 C 34 4, 74 3, 116 7 M10 12 C 44 8, 82 7, 112 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3.2}
                    strokeLinecap="round"
                  />
                </svg>
              </span>{" "}
              thing,
            </span>
            <br />
            <span className="write-line write-line-2 inline-block">not someone else&rsquo;s</span>
          </h2>
        </div>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-[1180px] gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {GIVES_YOU.map((g) => (
            <div key={g.word} className="text-center">
              <p className="written accent-text" style={{ fontSize: "clamp(34px, 4vw, 48px)" }}>
                {g.word}
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{g.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- the ten steps ---------------- */}
      <section id="how" className="scroll-mt-6 px-6 py-24">
        <Reveal>
        <SectionHead
          kicker="How it works"
          title="Ten steps, and none of them scary"
          blurb="The journey to becoming a Letting Expert, start to finish."
        />
        </Reveal>
        <ol className="mx-auto mt-12 grid max-w-[1180px] gap-3 sm:grid-cols-2">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="flex gap-4 rounded-2xl border border-line p-5">
              <span
                className="written shrink-0 accent-text"
                style={{ fontSize: 26, lineHeight: 1 }}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-semibold">{title}</span>
                <span className="mt-1 block text-[13px] leading-relaxed text-muted">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- Susan ---------------- */}
      <section id="founder" className="relative scroll-mt-6 px-6 py-24">
        <div className="mx-auto grid max-w-[1180px] items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="relative">
            <Scribble name="sparkles" className="-left-4 -top-5 hidden h-14 w-14 lg:block" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/illustrations/notioly/growth.svg"
              alt=""
              aria-hidden
              className="mx-auto w-[78%]"
            />
          </div>
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] accent-text">
              Meet the founder
            </span>
            <h2 className="written mt-3 tracking-tight" style={{ fontSize: "clamp(28px, 3.4vw, 40px)", lineHeight: 1.1 }}>
              Susan Liles
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-muted">
              Over 25 years in the industry — leading national corporate branches,
              pioneering self-employed models, and advising proptech and insurance
              firms. She&rsquo;s seen the lettings landscape evolve, and helped shape it.
            </p>
            <blockquote className="mt-5 border-l-2 border-accent pl-4 text-[14.5px] leading-relaxed">
              &ldquo;I built this model because I believe letting agents deserve more:
              more freedom, more support, more reward. If you&rsquo;re passionate about
              lettings and ready to grow your own business, this is where your future
              begins.&rdquo;
            </blockquote>
          </div>
        </div>
      </section>

      {/* ---------------- testimonials ---------------- */}
      <section className="px-6 py-24">
        <SectionHead kicker="In their words" title="Don't just take ours for it" />
        <div className="mx-auto mt-12 grid max-w-[1180px] gap-4 sm:grid-cols-2">
          {VOICES.map((v) => (
            <figure key={v.who} className="rounded-2xl border border-line p-6">
              <p className="written text-[17px]">{v.head}</p>
              <blockquote className="mt-3 text-[13.5px] leading-relaxed text-muted">
                &ldquo;{v.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-4 flex items-center gap-2 text-[12.5px]">
                <span className="font-semibold">{v.who}</span>
                <span className="text-muted">· {v.where} Letting Expert</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ---------------- values ---------------- */}
      <section className="px-6 py-24">
        <SectionHead kicker="Our core values" title="What we actually mean by culture" />
        <div className="mx-auto mt-12 grid max-w-[1180px] gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {VALUES.map(([t, b]) => (
            <div key={t} className="card p-6">
              <h3 className="written text-[19px]">{t}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- faqs ---------------- */}
      <section id="faqs" className="scroll-mt-6 px-6 py-24">
        <Reveal>
        <SectionHead
          kicker="Still not sure?"
          title="The questions everyone asks"
          blurb="Making the move to self-employment can feel a little scary. Here's the honest version."
        />
        </Reveal>
        <div className="mx-auto mt-10 max-w-2xl space-y-3">
          {FAQS.map(([q, a]) => (
            <Faq key={q} q={q} a={a} />
          ))}
        </div>
      </section>

      {/* ---------------- final CTA ---------------- */}
      <section className="relative overflow-hidden px-6 py-28">
        <Scribble name="underline" className="left-1/2 top-[52%] hidden h-10 w-56 -translate-x-1/2 text-ink/40 lg:block" />
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="written tracking-tight" style={{ fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.05 }}>
            Ready to find out if it&rsquo;s for you?
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[14.5px] leading-relaxed text-muted">
            Start with the suitability quiz. It takes a couple of minutes, and it&rsquo;s
            the honest way to find out whether this is the right move — for both of us.
          </p>
          <a
            href={QUIZ}
            className="btn-press mt-8 inline-block rounded-full bg-accent px-8 py-3.5 text-[15px] font-semibold text-white"
          >
            Take the suitability quiz →
          </a>
        </div>
      </section>

      <footer className="border-t border-line px-6 py-12 text-center text-[12px] text-muted">
        <p>© The Letting Experts {new Date().getFullYear()}. All rights reserved.</p>
        <p className="mt-1">
          Newman Property Services Ltd. Registered in England &amp; Wales. Company No: 4018410.
        </p>
      </footer>
    </div>
  );
}
