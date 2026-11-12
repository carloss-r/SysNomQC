"use client";

import { KeyRound, Mail, ShieldCheck } from "lucide-react";
import Image from "next/image";
import type { FormEvent } from "react";
import { useState } from "react";
import { Field } from "@/shared/ui/field";
import { useAuth } from "./auth-provider";

export function LoginScreen() {
  const { signIn, signingIn, authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signIn(email, password);
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <Image src="/logo-cooperativa.jpg" alt="Logotipo de Cooperativa Quinta Generación" width={92} height={92} priority />
        </div>
        <p className="eyebrow">SISTEMA DE CONTROL OPERATIVO</p>
        <h1>Gestión de Personal</h1>
        <p className="login-copy">Ingresa con tu cuenta autorizada para consultar los expedientes de la cooperativa.</p>

        <form onSubmit={handleSubmit} className="login-form">
          <Field label="Usuario o correo electrónico" required>
            <span className="input-icon"><Mail size={17} /></span>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={150}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="usuario o nombre@cooperativa.com"
              required
            />
          </Field>
          <Field label="Contraseña" required>
            <span className="input-icon"><KeyRound size={17} /></span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Tu contraseña"
              required
            />
          </Field>
          {authError && <p className="inline-error" role="alert">{authError}</p>}
          <button type="submit" className="button button-primary login-submit" disabled={signingIn}>
            {signingIn ? "Validando acceso…" : "Iniciar sesión"}
          </button>
        </form>

        <div className="login-security"><ShieldCheck size={16} /> Acceso privado para personal autorizado</div>
      </section>
      <footer className="login-footer">© 2026 Cooperativa Quinta Generación S.C. de R.L. de C.V.</footer>
    </main>
  );
}
