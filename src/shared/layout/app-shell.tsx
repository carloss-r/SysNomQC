"use client";

import { CircleUserRound, LogOut, Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LoginScreen } from "@/features/auth/login-screen";
import { useAuth } from "@/features/auth/auth-provider";
import { NotificationsBell } from "@/features/notifications/notifications-bell";
import { NotificationsProvider } from "@/features/notifications/notifications-provider";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import { Sidebar } from "./sidebar";

function Splash({ message }: { message: string }) {
  return (
    <main className="screen-center">
      <Image className="splash-logo" src="/logo-cooperativa.jpg" alt="Cooperativa Quinta Generación" width={104} height={104} priority />
      <p>{message}</p>
    </main>
  );
}

// Marco de la aplicación: valida la sesión, muestra la barra superior con el logotipo y el menú
// desplegable. Cada pantalla vive en su propia ruta (src/app/(app)/...) con su propio error.tsx,
// así que si una falla solo se reemplaza el contenido; el menú y las demás pantallas siguen.
export function AppShell({ children }: { children: ReactNode }) {
  const { status, access, authError, session, signOut, retry } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (status === "loading") return <Splash message="Conectando con el sistema…" />;
  if (status === "signedOut") return <LoginScreen />;

  if (status === "error") {
    return (
      <main className="screen-center">
        <Image className="splash-logo" src="/logo-cooperativa.jpg" alt="Cooperativa Quinta Generación" width={80} height={80} />
        <h1>No se pudo verificar tu cuenta</h1>
        <p>{authError}</p>
        <div className="shell-actions">
          <button type="button" className="button button-primary" onClick={retry}>Reintentar</button>
          <button type="button" className="button button-neutral" onClick={() => void signOut()}>Cerrar sesión</button>
        </div>
      </main>
    );
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
  }

  return (
    <NotificationsProvider key={session?.user.id}>
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button menu-button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={menuOpen}
              aria-controls="main-menu"
            >
              <Menu size={22} />
            </button>
            <Link className="brand" href="/" aria-label="Cooperativa Quinta Generación, inicio">
              <Image src="/logo-cooperativa.jpg" alt="" width={52} height={52} priority />
              <span className="brand-copy">
                <strong>COOPERATIVA QUINTA GENERACIÓN</strong>
                <small>S.C. DE R.L. DE C.V.</small>
              </span>
            </Link>
          </div>
          <div className="topbar-actions">
            <span className="connection-status"><span /> Sistema de Control Operativo</span>
            <span className="signed-user" title={session?.user.email ?? ""}>
              <CircleUserRound size={18} />
              <span>{access?.full_name || session?.user.email}</span>
              {access && <small className="role-chip">{access.role_name}</small>}
            </span>
            <NotificationsBell />
            <ThemeToggle />
            <button className="icon-button logout-button hide-phone" onClick={() => void handleSignOut()} disabled={signingOut} aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onSignOut={() => void handleSignOut()} />
      {menuOpen && <button type="button" className="sidebar-backdrop" aria-label="Cerrar menú" tabIndex={-1} onClick={() => setMenuOpen(false)} />}

      {children}

      <footer className="app-footer">
        <span>© 2026 Cooperativa Quinta Generación S.C. de R.L. de C.V.</span>
      </footer>
    </div>
    </NotificationsProvider>
  );
}
