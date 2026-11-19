"use client";

import { Flame, KeyRound, Lock, UserRound } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { ThemeToggle } from "@/shared/ui/theme-toggle";

// Acceso al SCA: mismas cuentas y contraseñas que el sistema principal (misma sesión de Supabase),
// con su propia presentación.
export function FuelsLogin() {
  const { signIn, signingIn, authError } = useAuth();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signIn(user, password);
  }

  return (
    <main className="sca-login">
      <div className="sca-login-theme"><ThemeToggle /></div>
      <form className="sca-login-form" onSubmit={handleSubmit}>
        <div className="sca-login-head">
          <span className="sca-brand-mark"><Flame size={18} /></span>
          <span>
            <strong>SCA</strong>
            <small>Sistema de Combustibles Alternos</small>
          </span>
        </div>
        <h1>Iniciar sesión</h1>
        <p className="sca-login-copy">Usa el mismo usuario y contraseña del sistema de la cooperativa.</p>

        <label className="sca-input">
          <span>Usuario o correo</span>
          <div>
            <UserRound size={16} />
            <input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={150} value={user} onChange={(event) => setUser(event.target.value)} placeholder="usuario" required />
          </div>
        </label>
        <label className="sca-input">
          <span>Contraseña</span>
          <div>
            <KeyRound size={16} />
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tu contraseña" required />
          </div>
        </label>

        {authError && <p className="sca-login-error" role="alert">{authError}</p>}

        <button type="submit" className="sca-login-submit" disabled={signingIn}>
          {signingIn ? "Validando…" : "Entrar"}
        </button>
        <p className="sca-login-foot"><Lock size={13} /> Acceso privado · Cooperativa Quinta Generación</p>
      </form>
    </main>
  );
}
