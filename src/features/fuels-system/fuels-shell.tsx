"use client";

import { ArrowLeftRight, CircleUserRound, Flame, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ForcePasswordScreen } from "@/features/account/force-password-screen";
import { useAuth } from "@/features/auth/auth-provider";
import { fmt, LEVEL_LABELS } from "@/lib/fuels";
import { roleLabels } from "@/lib/roles";
import { SystemSwitcher } from "@/shared/layout/system-switcher";
import { Spinner } from "@/shared/ui/loading";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import { FuelsDataProvider, useFuels } from "./fuels-data";
import { FuelsLogin } from "./fuels-login";
import { findScaItem, SCA_NAVIGATION } from "./navigation";

/** Marca el documento mientras se está en el SCA: el tema visual (sca.css) y los modales lo usan. */
function useSystemMark() {
  useEffect(() => {
    document.documentElement.dataset.system = "sca";
    return () => {
      delete document.documentElement.dataset.system;
    };
  }, []);
}

function ScaCenter({ children }: { children: ReactNode }) {
  return (
    <main className="sca-center">
      <div className="sca-login-logo"><Flame size={28} /></div>
      {children}
    </main>
  );
}

export function FuelsShell({ children }: { children: ReactNode }) {
  const { status, access, authError, signOut, retry, can } = useAuth();
  useSystemMark();

  let content: ReactNode;
  if (status === "loading") content = <ScaCenter><p className="sca-mono">Conectando con el SCA…</p></ScaCenter>;
  else if (status === "signedOut") content = <FuelsLogin />;
  else if (status === "error") {
    content = (
      <ScaCenter>
        <h1>No se pudo verificar tu cuenta</h1>
        <p>{authError}</p>
        <div className="shell-actions">
          <button type="button" className="button button-gold" onClick={retry}>Reintentar</button>
          <button type="button" className="button button-neutral" onClick={() => void signOut()}>Cerrar sesión</button>
        </div>
      </ScaCenter>
    );
  } else if (access?.must_change_password) content = <ForcePasswordScreen />;
  else if (!can("fuels.view")) {
    content = (
      <ScaCenter>
        <h1>Sin acceso al SCA</h1>
        <p>Tu rol no tiene permiso para el sistema de combustibles alternos.</p>
        <div className="shell-actions">
          <Link className="button button-gold" href="/personal">Ir al sistema principal</Link>
          <button type="button" className="button button-neutral" onClick={() => void signOut()}>Cerrar sesión</button>
        </div>
      </ScaCenter>
    );
  } else {
    content = (
      <FuelsDataProvider>
        <ScaFrame>{children}</ScaFrame>
      </FuelsDataProvider>
    );
  }

  return <div className="sca-root">{content}</div>;
}

function ScaFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { access, can, signOut } = useAuth();
  const { summary, stats, today } = useFuels();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const current = findScaItem(pathname);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
  }

  const sections = SCA_NAVIGATION.map((section) => ({ ...section, items: section.items.filter((item) => can(item.permission)) })).filter((section) => section.items.length);

  return (
    <div className={`sca-layout${menuOpen ? " menu-open" : ""}`}>
      <aside className="sca-sidebar" aria-label="Menú del SCA">
        <div className="sca-brand">
          <span className="sca-brand-mark"><Flame size={20} /></span>
          <span>
            <strong>SCA</strong>
            <small>Combustibles alternos</small>
          </span>
          <button type="button" className="sca-icon sca-only-mobile" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú"><X size={18} /></button>
        </div>

        <div className={`sca-side-meter sca-level-${summary.level}`}>
          <span className="sca-mono">Sustitución del mes</span>
          <strong>{summary.pct === null ? "—" : `${fmt(summary.pct, 1)} %`}</strong>
          <div className="sca-side-bar"><span style={{ width: `${Math.min(100, ((summary.pct ?? 0) / 40) * 100)}%` }} /><i style={{ left: "62.5%" }} /><i style={{ left: "75%" }} /></div>
          <small>{LEVEL_LABELS[summary.level]} · límite 30 %</small>
        </div>

        <nav className="sca-nav">
          {sections.map((section) => (
            <div key={section.title} className="sca-nav-section">
              <p>{section.title}</p>
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = current?.href === item.href;
                const badge = item.href.endsWith("/bascula") && stats.inPlant ? stats.inPlant : item.href.endsWith("/proveedores") && stats.expiring ? stats.expiring : 0;
                return (
                  <Link key={item.href} href={item.href} className={`sca-nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                    <Icon size={18} />
                    <span>
                      {item.label}
                      <small>{item.hint}</small>
                    </span>
                    {badge > 0 && <em>{badge}</em>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sca-side-foot">
          <Link href="/personal" className="sca-nav-link sca-back">
            <ArrowLeftRight size={17} />
            <span>Sistema principal</span>
          </Link>
          <div className="sca-user">
            <CircleUserRound size={20} />
            <span>
              {access?.full_name || access?.email || "Mi cuenta"}
              {access && <small>{roleLabels(access.role_names)}</small>}
            </span>
            <button type="button" className="sca-icon" onClick={() => void handleSignOut()} disabled={signingOut} aria-label="Cerrar sesión" title="Cerrar sesión">
              {signingOut ? <Spinner /> : <LogOut size={17} />}
            </button>
          </div>
        </div>
      </aside>
      {menuOpen && <button type="button" className="sca-backdrop" aria-label="Cerrar menú" tabIndex={-1} onClick={() => setMenuOpen(false)} />}

      <div className="sca-main">
        <header className="sca-topbar">
          <button type="button" className="sca-icon sca-only-mobile" onClick={() => setMenuOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button>
          <div className="sca-crumb">
            <span className="sca-mono">SCA /</span>
            <strong>{current?.label ?? "Combustibles alternos"}</strong>
          </div>
          <div className="sca-top-actions">
            <span className="sca-chip sca-mono">{today.split("-").reverse().join("/")}</span>
            <SystemSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <div className="sca-content">{children}</div>
        <footer className="sca-footer sca-mono">SCA · Cooperativa Quinta Generación · límite SEMARNAT 30 %</footer>
      </div>
    </div>
  );
}
