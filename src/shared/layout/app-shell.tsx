"use client";

import { CircleUserRound, LogOut, Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { LoginScreen } from "@/features/auth/login-screen";
import { useAuth } from "@/features/auth/auth-provider";
import { Sidebar } from "./sidebar";

function Splash({ message }: { message: string }) {
  return (
    <main className="screen-center">
      <div className="loading-mark"><span>QG</span></div>
      <p>{message}</p>
    </main>
  );
}

// Marco de la aplicación: valida la sesión, muestra el menú lateral y la barra superior.
// Cada pantalla vive en su propia ruta (src/app/(app)/...) con su propio error.tsx, así que
// si una falla solo se reemplaza el contenido; el menú y las demás pantallas siguen funcionando.
export function AppShell({ children }: { children: ReactNode }) {
  const { status, access, authError, session, signOut, retry } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (status === "loading") return <Splash message="Conectando con el sistema…" />;
  if (status === "signedOut") return <LoginScreen />;

  if (status === "error") {
    return (
      <main className="screen-center">
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
    <div className="shell">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <button type="button" className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}

      <div className="shell-main">
        <header className="shell-topbar">
          <button type="button" className="icon-button sidebar-toggle" onClick={() => setMenuOpen((value) => !value)} aria-label="Abrir menú" aria-expanded={menuOpen}>
            <Menu size={20} />
          </button>
          <span className="shell-spacer" />
          <span className="signed-user" title={session?.user.email ?? ""}>
            <CircleUserRound size={18} />
            <span>{access?.full_name || session?.user.email}</span>
            {access && <small className="role-chip">{access.role_name}</small>}
          </span>
          <button className="icon-button shell-logout" onClick={() => void handleSignOut()} disabled={signingOut} aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut size={18} />
          </button>
        </header>

        {children}

        <footer className="app-footer">
          <span>© 2026 Cooperativa Quinta Generación S.C. de R.L. de C.V.</span>
        </footer>
      </div>
    </div>
  );
}
