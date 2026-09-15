"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sections of the dashboard. Adding one is a new entry plus a new route. */
const SECTIONS = [{ href: "/", label: "Automations", matches: ["/", "/automations"] }];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="px-2 py-3">
      <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-faint">Sections</div>
      {SECTIONS.map((section) => {
        const active = section.matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
        return (
          <Link
            key={section.href}
            href={section.href}
            className={`block rounded px-2 py-1.5 text-sm transition-colors ${
              active ? "bg-raised text-ink" : "text-dim hover:bg-raised/60 hover:text-ink"
            }`}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
