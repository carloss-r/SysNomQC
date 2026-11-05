"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";
import { NAVIGATION } from "@/shared/config/navigation";

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  const { can } = useAuth();

  const sections = NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((section) => section.items.length > 0);

  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="Menú principal">
      <Link className="sidebar-brand" href="/" onClick={onNavigate} aria-label="Cooperativa Quinta Generación, inicio">
        <Image src="/logo-cooperativa.jpg" alt="" width={46} height={46} priority />
        <span className="brand-copy">
          <strong>QUINTA GENERACIÓN</strong>
          <small>CONTROL OPERATIVO</small>
        </span>
      </Link>

      <nav className="sidebar-nav">
        {sections.map((section) => (
          <div className="nav-section" key={section.title}>
            <p className="nav-section-title">{section.title}</p>
            {section.items.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link${active ? " active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
