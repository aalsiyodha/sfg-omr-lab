/**
 * Temporary design fixtures, NOT real customer records or an auth layer.
 * All tenant data must eventually be fetched with server-side membership
 * checks and Row Level Security (RLS).
 */
export type DemoTenant = {
  slug: "sfg" | "abc";
  name: string;
  description: string;
  initials: string;
  accent: string;
  allowedFormats: readonly (50 | 100 | 150)[];
};

export const DEMO_TENANTS: Record<DemoTenant["slug"], DemoTenant> = {
  sfg: {
    slug: "sfg",
    name: "SFG Academy",
    description: "Focused, high-frequency practice examinations.",
    initials: "SF",
    accent: "#4f46e5",
    allowedFormats: [50],
  },
  abc: {
    slug: "abc",
    name: "ABC Institute",
    description: "An example tenant workspace for migration testing.",
    initials: "AB",
    accent: "#0d9488",
    allowedFormats: [50, 100, 150],
  },
};

export function getDemoTenant(slug: string): DemoTenant | null {
  return Object.prototype.hasOwnProperty.call(DEMO_TENANTS, slug)
    ? DEMO_TENANTS[slug as DemoTenant["slug"]]
    : null;
}
