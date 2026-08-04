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

import { useEffect, useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";
import { Mark } from "./Doodles";
import Reveal from "./Reveal";
import OsShowcase from "./OsShowcase";

/* ------------------------------ the content ------------------------------ */

const LOVE = [
  { icon: "clock", text: "Flexible working hours built around your family & lifestyle" },
  { icon: "coin", text: "A higher income to support the lifestyle you strive toward" },
  { icon: "target", text: "Control of your own destiny: working how you want" },
  { icon: "star", text: "A better quality of life that nurtures your health & wellbeing" },
];

const EARN = [
  {
    figure: "100%",
    label: "of your commission",
    body: "No branch to fund, no manager taking a cut before you see it.",
  },
  {
    figure: "£0",
    label: "in area restrictions",
    body: "Any property, any location, any price range. No postcode carve-ups.",
  },
  {
    figure: "24/7",
    label: "on your own terms",
    body: "Set the hours around your life instead of the other way round.",
  },
];

const BLOCKERS = [
  {
    fear: "I can't afford to go without a salary.",
    answer: "That's the honest risk, and why step one is a suitability quiz rather than a contract. We'd rather you found out now than six months in.",
  },
  {
    fear: "I don't know how to find my own leads.",
    answer: "The Success Blueprint is the step-by-step version, and a Success Coach holds you to it. You're not handed a laptop and wished well.",
  },
  {
    fear: "The compliance side terrifies me.",
    answer: "A support team handles pre-tenancy compliance, move-ins and rent collection — and the software tells you what's expiring before it does.",
  },
  {
    fear: "I'd be doing it on my own.",
    answer: "You'd be self-employed, not alone. A national network, weekly sessions, live events, and people who've already done the bit you're on.",
  },
];

const WHO = [
  {
    title: "Letting agency employees",
    body: "Feeling trapped in a high street office, restricted by rigid rules and limitations. Working hard for someone else's dream, yet unappreciated, undervalued and limited to what you can earn.",
  },
  {
    title: "Letting agency business owners",
    body: "Generating a decent income but little or no profit once the bills, salaries and ever-increasing costs are met — and no time left to concentrate on the core of your business.",
  },
  {
    title: "Self-employed letting agents",
    body: "Unsupported and lacking guidance with your current brand. Looking for a network with the best tools, a dedicated marketing team, a success blueprint and a personal coach.",
  },
  {
    title: "Budding entrepreneurs",
    body: "Ambitious, with an entrepreneurial mindset and a goal to own a successful business — in control of your destiny, working flexible hours and earning a significant income.",
  },
  {
    title: "Career changers",
    body: "Eager to break free from the 9–5, the office politics and the commute, with a solid foundation in sales, marketing and customer service you want to put to better use.",
  },
];

const GIVE = [
  {
    icon: "rocket",
    title: "Training, coaching and accountability",
    body: "A 'Success Blueprint' — a step-by-step guide with proven systems, processes and strategies to build your lettings business.",
  },
  {
    icon: "dashboard",
    title: "Industry-leading tools and technology",
    body: "A CRM built specifically for self-employed agents, lead generation tools, and pre-tenancy and property management platforms that cut the admin.",
  },
  {
    icon: "shield",
    title: "Property management and legislation",
    body: "The latest training, keeping you up to speed with legislation and your portfolio compliant. Accredited qualifications available.",
  },
  {
    icon: "checklist",
    title: "Lettings and compliance support team",
    body: "Full support with pre-tenancy compliance, the move-in process and rent collection, so you can focus on the income-producing work.",
  },
  {
    icon: "user",
    title: "Your own agent success coach",
    body: "There to help you succeed — admin, tech, pipeline management and compliance.",
  },
  {
    icon: "home-1",
    title: "No postcode restrictions",
    body: "List any property, in any location, in any price range. No area restrictions placed upon you at all.",
  },
  {
    icon: "megaphone",
    title: "Support to build your personal brand",
    body: "This business is about marketing your brand and your properties — and you get the help to do it properly.",
  },
  {
    icon: "file-contract",
    title: "Printed and digital marketing",
    body: "A dedicated marketing team constantly creating assets you can personalise and use to generate business.",
  },
  {
    icon: "trend-up",
    title: "Support to build your portfolio",
    body: "The Letting Experts Blueprint gives you everything you need to build a profitable management portfolio.",
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
        className="hand mt-3 tracking-tight"
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
 * The hero photo, with an honest fallback.
 *
 * An `onError` on a plain <img> is not enough: the request fails during SSR
 * hydration, before React has attached the handler, so the browser paints its
 * broken-image state and the swap never happens. This probes for the file first
 * and only renders it once it has actually loaded — so the page shows a figure
 * while the photo is missing, and never a broken frame.
 *
 * Drop the real image at /public/recruitment/hero.jpg and it takes over on the
 * next load. Nothing else needs changing.
 */
function HeroImage() {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setPhoto("/recruitment/hero.jpg");
    img.src = "/recruitment/hero.jpg";
  }, []);

  return (
    <figure className="relative mx-auto mt-12 max-w-3xl">
      <Mark name="sparks" className="-right-8 -top-6 hidden w-14 lg:block" />
      <div className="card overflow-hidden p-0">
        {photo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={photo} alt="A Letting Expert at work" className="block h-auto w-full object-cover" />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src="/illustrations/notioly/accomplishment.svg"
            alt=""
            aria-hidden
            className="mx-auto block w-[62%] py-12"
          />
        )}
      </div>
      {!photo ? (
        <figcaption className="mt-2 text-[11px] text-muted">
          Placeholder — drop the hero photo at <code>/public/recruitment/hero.jpg</code>
        </figcaption>
      ) : null}
    </figure>
  );
}

/* ---------------------------------- page --------------------------------- */

export default function RecruitmentPage() {
  const QUIZ = "https://join.thelettingexperts.co.uk/join-us";

  return (
    <div className="outline-cards soft-cards min-h-screen bg-page">
      {/* ---------------- nav ---------------- */}
      {/* No bottom rule: the hero sits on the same canvas, and a hairline
          across the top only served to cut the page in half before it began. */}
      <header className="sticky top-0 z-40 bg-page/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-start justify-between px-6 py-5">
          {/* Stacked wordmark — three lines, tight, so it reads as a mark
              rather than a sentence in the corner. */}
          <span className="hand text-[15px] leading-[0.95] tracking-tight sm:text-[17px]">
            The
            <br />
            Letting
            <br />
            Experts
          </span>
          <a
            href={QUIZ}
            className="cta cta-dark rounded-full px-4 py-2 text-[13px] font-medium"
          >
            Suitability quiz
          </a>
        </div>
      </header>

      {/* ---------------- hero ---------------- */}
      {/* An inverted pyramid: the title is the widest element, the subtext sits
          inside it, the buttons inside that. Each measure is set deliberately
          rather than left to the container, so the eye funnels down to the CTA
          instead of reading three stacked blocks of the same width. */}
      <section className="relative px-6 pb-0 pt-8 sm:pt-14">
        <Mark name="swirl" className="left-[2%] top-[26%] hidden w-24 xl:block" />
        <Mark name="grass" className="right-[3%] top-[16%] hidden w-20 xl:block" />

        <div className="mx-auto max-w-[1180px] text-center">
          <h1
            className="hand mx-auto max-w-[15ch] tracking-tight"
            style={{ fontSize: "clamp(42px, 7.4vw, 92px)", lineHeight: 0.94 }}
          >
            Run your own lettings business
          </h1>

          <p className="mx-auto mt-6 max-w-[46ch] text-[15px] leading-relaxed text-muted sm:text-[16.5px]">
            You already know how to let and manage property. This is the model that
            lets you do it for yourself — with the tools, the training and a support
            team behind you.
          </p>

          <div className="mx-auto mt-8 flex max-w-[30rem] flex-wrap items-center justify-center gap-3">
            <a href={QUIZ} className="cta cta-accent rounded-full px-7 py-3.5 text-[14.5px] font-semibold">
              Suitability quiz
            </a>
            <a href="#earn" className="cta cta-ghost rounded-full px-7 py-3.5 text-[14.5px] font-medium">
              See what you could earn
            </a>
          </div>
        </div>

        {/* The showcase deliberately runs off the bottom of the section and is
            clipped by the next one. A panel that stops short reads as finished;
            one that continues past the fold is the reason someone scrolls. */}
        <Reveal delay={120}>
          <div className="relative mx-auto mt-14 max-w-[1080px] px-2">
            <OsShowcase />
          </div>
        </Reveal>
      </section>

      {/* ---------------- what you could earn / what's stopping you -------- */}
      {/* Deliberately the FIRST thing after the hero. The old page went
          straight to "who it's for", which asks the reader to place themselves
          in a category before they have been given a reason to care. Money and
          the thing standing between them and it come first. */}
      <section id="earn" className="relative px-6 py-24">
        <Mark name="loop" className="right-[3%] top-[8%] hidden w-28 xl:block" />
        <div className="mx-auto max-w-[1180px]">
          <Reveal>
            <div className="max-w-[52ch]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] accent-text">
                The honest bit
              </span>
              <h2
                className="hand mt-3 tracking-tight"
                style={{ fontSize: "clamp(32px, 4.6vw, 58px)", lineHeight: 1.02 }}
              >
                What you could earn, and what&rsquo;s stopping you
              </h2>
              <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-muted">
                There&rsquo;s no salary here — it&rsquo;s your business. Which means the
                ceiling comes off, and so does the safety net. Both halves of that
                deserve saying out loud.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {/* what you keep */}
            <Reveal delay={60}>
              <div className="flex h-full flex-col rounded-2xl border border-line bg-card p-7">
                <div className="flex items-center gap-2.5">
                  <span className="accent-text"><DoodleIcon name="coin" size={20} /></span>
                  <h3 className="text-[15px] font-semibold">What you could earn</h3>
                </div>
                <div className="mt-6 flex flex-1 flex-col justify-around gap-6">
                  {EARN.map((e) => (
                    <div key={e.label} className="flex items-baseline gap-4">
                      <span className="hand shrink-0 tracking-tight" style={{ fontSize: "clamp(30px,3.4vw,42px)", lineHeight: 1 }}>
                        {e.figure}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium">{e.label}</span>
                        <span className="block text-[12.5px] leading-relaxed text-muted">{e.body}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-6 border-t border-line pt-4 text-[11.5px] leading-relaxed text-muted">
                  Illustrative, not a promise — what you earn depends on the portfolio
                  you build. We&rsquo;ll walk you through the real numbers on the call.
                </p>
              </div>
            </Reveal>

            {/* what's stopping you */}
            <Reveal delay={120}>
              <div className="h-full rounded-2xl border border-line bg-card p-7">
                <div className="flex items-center gap-2.5">
                  <span className="accent-text"><DoodleIcon name="lock" size={20} /></span>
                  <h3 className="text-[15px] font-semibold">What&rsquo;s holding you back</h3>
                </div>
                <div className="mt-6 space-y-3">
                  {BLOCKERS.map((b) => (
                    <div key={b.fear} className="rounded-xl border border-line p-4">
                      <p className="text-[13.5px] font-medium">
                        <span className="text-muted">&ldquo;</span>{b.fear}<span className="text-muted">&rdquo;</span>
                      </p>
                      <p className="mt-1.5 flex gap-2 text-[12.5px] leading-relaxed text-muted">
                        <span className="shrink-0 accent-text">→</span>
                        {b.answer}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- who it's for ---------------- */}
      <section className="relative px-6 py-24">
        <Mark name="loop" className="right-[4%] top-[6%] hidden w-28 lg:block" />
        <Reveal>
        <SectionHead
          kicker="Who it's for"
          title="You&rsquo;ll recognise yourself here"
          blurb="The model suits people with estate agency, lettings and property management experience — however they got it."
        />
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-[1180px] gap-4 md:grid-cols-2 lg:grid-cols-3">
          {WHO.map((w) => (
            <div key={w.title} className="card card-lift p-6">
              <h3 className="text-[15px] font-semibold">{w.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{w.body}</p>
            </div>
          ))}
          <div className="card flex flex-col justify-center bg-ink p-6 text-white">
            <p className="hand text-[22px] leading-snug">
              &ldquo;Everyone deserves to live their best life.&rdquo;
            </p>
            <p className="mt-3 text-[12.5px] text-white/70">
              Sean Newman, Founder, The Experts Group
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- what you get ---------------- */}
      <section className="border-y border-line bg-card px-6 py-24">
        <Reveal>
        <SectionHead
          kicker="What we give you"
          title="Everything you need to be dangerous"
          blurb="Our goal is the best and most attractive business model for self-employed letting agents in the UK. So you get the lot."
        />
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-[1180px] gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GIVE.map((g) => (
            <div key={g.title} className="rounded-2xl border border-line p-6">
              <span className="accent-text">
                <DoodleIcon name={g.icon} size={24} />
              </span>
              <h3 className="mt-4 text-[14.5px] font-semibold">{g.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{g.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- what it gives you ---------------- */}
      <section className="relative px-6 py-24">
        <Mark name="arrow" className="left-[6%] top-[10%] hidden w-24 lg:block" />
        <Reveal>
        <SectionHead
          kicker="What you get out"
          title="Building your own thing, not someone else's"
        />
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-[1180px] gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {GIVES_YOU.map((g) => (
            <div key={g.word} className="text-center">
              <p className="hand accent-text" style={{ fontSize: "clamp(34px, 4vw, 48px)" }}>
                {g.word}
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{g.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- the ten steps ---------------- */}
      <section id="how" className="border-y border-line bg-card px-6 py-24">
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
                className="hand shrink-0 accent-text"
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
      <section className="relative px-6 py-24">
        <div className="mx-auto grid max-w-[1180px] items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="relative">
            <Mark name="sparks" className="-left-6 -top-6 hidden w-16 lg:block" />
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
            <h2 className="hand mt-3 tracking-tight" style={{ fontSize: "clamp(28px, 3.4vw, 40px)", lineHeight: 1.1 }}>
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
      <section className="border-y border-line bg-card px-6 py-24">
        <SectionHead kicker="In their words" title="Don't just take ours for it" />
        <div className="mx-auto mt-12 grid max-w-[1180px] gap-4 sm:grid-cols-2">
          {VOICES.map((v) => (
            <figure key={v.who} className="rounded-2xl border border-line p-6">
              <p className="hand text-[17px]">{v.head}</p>
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
              <h3 className="hand text-[19px]">{t}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- faqs ---------------- */}
      <section className="border-y border-line bg-card px-6 py-24">
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
        <Mark name="underline" className="left-1/2 top-[46%] hidden w-64 -translate-x-1/2 lg:block" />
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="hand tracking-tight" style={{ fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.05 }}>
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
