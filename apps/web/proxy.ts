import { NextResponse, type NextRequest } from "next/server";
import { getDemoTenant } from "./lib/tenants";

/** Preview routing only. Security/authorization must occur in data access. */
export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const path = request.nextUrl.pathname;
  // Never rewrite system assets or framework internals.
  if (path.startsWith("/_next/") || path === "/favicon.ico") {
    return NextResponse.next();
  }

  // omrlabs.com: marketing; dashboard.omrlabs.com: staff dashboard.
  // Known institute subdomains map to internal /s/[slug] pages.
  let slug: string | null = null;
  if (host.endsWith(".omrlabs.com")) {
    slug = host.slice(0, -".omrlabs.com".length);
  } else if (host.endsWith(".localhost")) {
    slug = host.slice(0, -".localhost".length);
  }

  if (slug === "dashboard") {
    if (path === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }
  if (!slug || slug === "www" || slug === "admin" || slug === "app") {
    return NextResponse.next();
  }
  if (!getDemoTenant(slug)) {
    return new NextResponse("Unknown institute", { status: 404 });
  }
  // Keep internal routes accessible for local testing without DNS.
  if (path.startsWith("/s/")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = `/s/${slug}${path === "/" ? "" : path}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
