"use client";

import { ArrowRight, Flame, KeyRound, Lock, UserRound } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";

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
      <section className="sca-login-art" aria-hidden="true">
        <div className="sca-login-logo"><Flame size={30} /></div>
        <p className="sca-mono">SCA · v1</p>
        <h2>Sistema de Combustibles Alternos</h2>
        <p>Recepción, báscula, homologación de proveedores y control de sustitución térmica del horno.</p>
        <div className="sca-login-meter">
          <div><span style={{ width: "62%" }} /></div>
          <small className="sca-mono">0 % ─── 25 % ─── 30 % SEMARNAT</small>
        </div>
      </section>

      <section className="sca-login-form-wrap">
        <form className="sca-login-form" onSubmit={handleSubmit}>
          <p className="sca-kicker">Acceso restringido</p>
          <h1>Iniciar sesión</h1>
          <p className="sca-login-copy">Usa el mismo usuario y contraseña del sistema de la cooperativa.</p>

          <label className="sca-input">
            <span>Usuario o correo</span>
            <div>
              <UserRound size={17} />
              <input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={150} value={user} onChange={(event) => setUser(event.target.value)} placeholder="usuario" required />
            </div>
          </label>
          <label className="sca-input">
            <span>Contraseña</span>
            <div>
              <KeyRound size={17} />
              <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required />
            </div>
          </label>

          {authError && <p className="sca-login-error" role="alert">{authError}</p>}

          <button type="submit" className="sca-login-submit" disabled={signingIn}>
            {signingIn ? "Validando…" : <>Entrar al SCA <ArrowRight size={17} /></>}
          </button>
          <p className="sca-login-foot"><Lock size={13} /> Enlace privado · Cooperativa Quinta Generación</p>
        </form>
      </section>
    </main>
  );
}
