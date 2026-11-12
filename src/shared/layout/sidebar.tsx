"use client";

import { Bell, CircleUserRound, LogOut, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";
import { useNotifications } from "@/features/notifications/notifications-provider";
import { NAVIGATION } from "@/shared/config/navigation";
import { roleLabels } from "@/lib/roles";
import { ThemeToggle } from "@/shared/ui/theme-toggle";

// Menú lateral desplegable: permanece cerrado y se abre con el botón de tres rayas.
export function Sidebar({ open, onClose, onSignOut }: { open: boolean; onClose: () => void; onSignOut: () => void }) {
  const pathname = usePathname();
  const { can, access } = useAuth();
  const { active } = useNotifications();
  const urgent = active.filter((item) => item.severity !== "minor").length;
  const tabIndex = open ? 0 : -1;

  const sections = NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((section) => section.items.length > 0);

  return (
    <aside id="main-menu" className={`sidebar${open ? " open" : ""}`} aria-label="Menú principal" inert={!open}>
      <div className="sidebar-header">
        <span>MENÚ</span>
        <button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label="Cerrar menú" tabIndex={tabIndex}>
          <X size={20} />
        </button>
      </div>

      <nav className="sidebar-nav">
        {sections.map((section) => (
          <div className="nav-section" key={section.title}>
            <p className="nav-section-title">{section.title}</p>
            {section.items.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link${isActive ? " active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  tabIndex={tabIndex}
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

      <div className="sidebar-footer">
        <Link
          href="/notificaciones"
          className={`nav-link${pathname === "/notificaciones" ? " active" : ""}`}
          aria-current={pathname === "/notificaciones" ? "page" : undefined}
          tabIndex={tabIndex}
          onClick={onClose}
        >
          <Bell size={18} />
          <span>Notificaciones</span>
          {urgent > 0 && <span className="nav-count">{urgent > 99 ? "99+" : urgent}</span>}
        </Link>

        {/* En teléfono la barra superior solo deja lo indispensable; lo demás vive aquí. */}
        <div className="sidebar-account show-phone">
          <p className="sidebar-user">
            <CircleUserRound size={18} />
            <span>
              {access?.full_name || "Mi cuenta"}
              {access && <small>{roleLabels(access.role_names)}</small>}
            </span>
          </p>
          <ThemeToggle variant="menu" tabIndex={tabIndex} />
          <button type="button" className="nav-link nav-button" onClick={onSignOut} tabIndex={tabIndex}>
            <LogOut size={18} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
