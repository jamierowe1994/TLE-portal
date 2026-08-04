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
import { Circled, Mark } from "./Doodles";

/* ------------------------------ the content ------------------------------ */

const LOVE = [
  { icon: "clock", text: "Flexible working hours built around your family & lifestyle" },
  { icon: "coin", text: "A higher income to support the lifestyle you strive toward" },
  { icon: "target", text: "Control of your own destiny: working how you want" },
  { icon: "star", text: "A better quality of life that nurtures your health & wellbeing" },
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
      <header className="sticky top-0 z-40 border-b border-line/60 bg-page/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="hand text-[18px]">The Letting Experts</span>
          <a
            href={QUIZ}
            className="btn-press rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white"
          >
            Take the quiz →
          </a>
        </div>
      </header>

      {/* ---------------- hero ---------------- */}
      <section className="relative overflow-hidden px-5 pb-16 pt-14 sm:pt-20">
        <Mark name="swirl" className="left-[3%] top-[18%] hidden w-24 lg:block" />
        <Mark name="grass" className="right-[5%] top-[12%] hidden w-20 lg:block" />
        <Mark name="sparks" className="left-[8%] bottom-[8%] hidden w-16 xl:block" />

        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            For letting agents with 2+ years&rsquo; experience
          </span>

          <h1
            className="hand mx-auto mt-6 max-w-3xl tracking-tight"
            style={{ fontSize: "clamp(38px, 6.4vw, 74px)", lineHeight: 1.02 }}
          >
            Run your own lettings business, <Circled>your way</Circled>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-muted">
            You already know how to let and manage property. This is the model that
            lets you do it for yourself — with the tools, the training and the
            support team behind you.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={QUIZ}
              className="btn-press rounded-full bg-accent px-6 py-3 text-[14px] font-semibold text-white"
            >
              Take the suitability quiz →
            </a>
            <a
              href="#how"
              className="btn-press rounded-full border border-line bg-card px-6 py-3 text-[14px] font-medium"
            >
              See how it works
            </a>
          </div>

          <HeroImage />
        </div>
      </section>

      {/* ---------------- why people love it ---------------- */}
      <section className="border-y border-line bg-[#e8ecd7] px-5 py-14">
        <p className="text-center text-[13px] font-medium text-ink/70">
          Why people love this business opportunity
        </p>
        <div className="mx-auto mt-8 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LOVE.map((l) => (
            <div key={l.text} className="flex items-start gap-3">
              <span className="accent-text">
                <DoodleIcon name={l.icon} size={22} />
              </span>
              <p className="text-[13.5px] leading-relaxed">{l.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- who it's for ---------------- */}
      <section className="relative px-5 py-20">
        <Mark name="loop" className="right-[4%] top-[6%] hidden w-28 lg:block" />
        <SectionHead
          kicker="Who it's for"
          title={<>You&rsquo;ll recognise <Circled>yourself</Circled> here</>}
          blurb="The model suits people with estate agency, lettings and property management experience — however they got it."
        />
        <div className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-2 lg:grid-cols-3">
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
      <section className="border-y border-line bg-card px-5 py-20">
        <SectionHead
          kicker="What we give you"
          title="Everything you need to be dangerous"
          blurb="Our goal is the best and most attractive business model for self-employed letting agents in the UK. So you get the lot."
        />
        <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      <section className="relative px-5 py-20">
        <Mark name="arrow" className="left-[6%] top-[10%] hidden w-24 lg:block" />
        <SectionHead
          kicker="What you get out"
          title="Building your own thing, not someone else's"
        />
        <div className="mx-auto mt-12 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
      <section id="how" className="border-y border-line bg-card px-5 py-20">
        <SectionHead
          kicker="How it works"
          title={<>Ten steps, and none of them <Circled>scary</Circled></>}
          blurb="The journey to becoming a Letting Expert, start to finish."
        />
        <ol className="mx-auto mt-12 grid max-w-5xl gap-3 sm:grid-cols-2">
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
      <section className="relative px-5 py-20">
        <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
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
      <section className="border-y border-line bg-card px-5 py-20">
        <SectionHead kicker="In their words" title="Don't just take ours for it" />
        <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2">
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
      <section className="px-5 py-20">
        <SectionHead kicker="Our core values" title="What we actually mean by culture" />
        <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {VALUES.map(([t, b]) => (
            <div key={t} className="card p-6">
              <h3 className="hand text-[19px]">{t}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- faqs ---------------- */}
      <section className="border-y border-line bg-card px-5 py-20">
        <SectionHead
          kicker="Still not sure?"
          title="The questions everyone asks"
          blurb="Making the move to self-employment can feel a little scary. Here's the honest version."
        />
        <div className="mx-auto mt-10 max-w-2xl space-y-3">
          {FAQS.map(([q, a]) => (
            <Faq key={q} q={q} a={a} />
          ))}
        </div>
      </section>

      {/* ---------------- final CTA ---------------- */}
      <section className="relative overflow-hidden px-5 py-24">
        <Mark name="underline" className="left-1/2 top-[46%] hidden w-64 -translate-x-1/2 lg:block" />
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="hand tracking-tight" style={{ fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.05 }}>
            Ready to find out if it&rsquo;s <Circled>for you?</Circled>
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

      <footer className="border-t border-line px-5 py-10 text-center text-[12px] text-muted">
        <p>© The Letting Experts {new Date().getFullYear()}. All rights reserved.</p>
        <p className="mt-1">
          Newman Property Services Ltd. Registered in England &amp; Wales. Company No: 4018410.
        </p>
      </footer>
    </div>
  );
}
