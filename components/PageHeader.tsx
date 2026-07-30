// The top of a grid page: a big handwritten title with its blurb, and room
// on the right for a scene illustration. Same proportions everywhere so
// Compliance and Applications read as siblings of My Properties.

export default function PageHeader({
  title,
  blurb,
  art,
  artClass = "w-[300px] xl:w-[360px]",
  children,
}: {
  title: string;
  blurb?: string;
  /** Illustration path (public/illustrations). */
  art?: string;
  artClass?: string;
  /** Anything that belongs under the blurb — a summary line, say. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-6 pt-2">
      <div className="min-w-0 flex-1">
        <h1
          className="tracking-tight"
          style={{ fontSize: "clamp(32px, 3.6vw, 46px)", lineHeight: 1.05, fontWeight: 500 }}
        >
          {title}
        </h1>
        {blurb ? (
          <p className="mt-2.5 max-w-xl text-[13px] leading-relaxed text-muted">{blurb}</p>
        ) : null}
        {children}
      </div>
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={art}
          alt=""
          aria-hidden
          className={`pointer-events-none -mt-4 hidden shrink-0 lg:block ${artClass}`}
        />
      ) : null}
    </div>
  );
}
