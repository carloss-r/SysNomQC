"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";
import { NAVIGATION } from "@/shared/config/navigation";

// Menú lateral desplegable: permanece cerrado y se abre con el botón de tres rayas.
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { can } = useAuth();

  const sections = NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((section) => section.items.length > 0);

  return (
    <aside id="main-menu" className={`sidebar${open ? " open" : ""}`} aria-label="Menú principal" aria-hidden={!open}>
      <div className="sidebar-header">
        <span>MENÚ</span>
        <button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label="Cerrar menú" tabIndex={open ? 0 : -1}>
          <X size={20} />
        </button>
      </div>

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
                  tabIndex={open ? 0 : -1}
                  onClick={onClose}
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
