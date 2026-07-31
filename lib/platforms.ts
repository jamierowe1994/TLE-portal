// TLE OS — the systems an agent's business actually runs on, in one place.
//
// Links for now, integrations later: REX already feeds the portal's live funnel
// and portfolio, and REX PM + PayProp are the next ones to hook in. Adding a
// platform is just another entry here — the hub renders itself off this list.

export type PlatformSection = "platforms" | "training";

export interface Platform {
  id: string;
  name: string;
  blurb: string;
  /** null = we haven't been given the link yet. Renders as "link coming". */
  url: string | null;
  section: PlatformSection;
  /** Tint for the card's initial chip. */
  accent: string;
  /** True where the portal already pulls data from it, not just links out. */
  connected?: boolean;
}

export const PLATFORM_SECTIONS: {
  id: PlatformSection;
  title: string;
  blurb: string;
}[] = [
  { id: "platforms", title: "Platforms", blurb: "The systems you run the business on" },
  { id: "training", title: "Training", blurb: "Learning, onboarding and best practice" },
];

export const PLATFORMS: Platform[] = [
  {
    id: "rex",
    name: "REX",
    blurb: "Your CRM — appraisals, listings and pipeline.",
    url: null,
    section: "platforms",
    accent: "#1d4ed8",
    connected: true,
  },
  {
    id: "rexpm",
    name: "REX PM",
    blurb: "Property management — tenancies, maintenance and compliance.",
    url: "https://alfie.app.rexsoftware.com",
    section: "platforms",
    accent: "#0ea5e9",
  },
  {
    id: "payprop",
    name: "PayProp",
    blurb: "Rent collection, payments and reconciliation.",
    url: "https://www.payprop.com/uk",
    section: "platforms",
    accent: "#16a34a",
  },
  {
    id: "propoly",
    name: "Propoly",
    blurb: "Tenancy progression — referencing, Right to Rent, AML and digital agreements.",
    url: "https://www.propoly.com",
    section: "platforms",
    accent: "#7c3aed",
  },
  {
    id: "inventorybase",
    name: "InventoryBase",
    blurb: "Inventories, check-ins and property inspections.",
    url: "https://inventorybase.co.uk",
    section: "platforms",
    accent: "#ea580c",
  },
  {
    id: "flatfair",
    name: "Flatfair",
    blurb: "Deposit alternative — a flatbond per tenancy instead of a cash deposit.",
    url: "https://app.flatfair.co.uk",
    section: "platforms",
    accent: "#0f766e",
  },
  {
    id: "homesearch",
    name: "Homesearch",
    blurb: "Property data and prospecting — ownership, market intel and leads.",
    url: "https://homesearch.co.uk",
    section: "platforms",
    accent: "#4338ca",
  },
  // Meta deliberately isn't here — "My Ads" is already a top-level nav item, so
  // listing it again just duplicated it.
  {
    id: "training",
    name: "Training platform",
    blurb: "Courses, onboarding and ongoing development.",
    url: null,
    section: "training",
    accent: "#f59e0b",
  },
];

export function platformsIn(section: PlatformSection): Platform[] {
  return PLATFORMS.filter((p) => p.section === section);
}

/** Look one up by id — used to point a next-step at the platform that does it. */
export function platformById(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}
