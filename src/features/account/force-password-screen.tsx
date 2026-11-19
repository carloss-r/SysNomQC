"use client";

import { LogOut } from "lucide-react";
import Image from "next/image";
import { useAuth } from "@/features/auth/auth-provider";
import { PasswordForm } from "./password-form";

/** Contraseña temporal del administrador: hay que cambiarla antes de usar el sistema. */
export function ForcePasswordScreen() {
  const { access, signOut } = useAuth();
  return (
    <main className="login-page">
      <section className="login-panel account-force">
        <div className="login-brand">
          <Image src="/logo-cooperativa.jpg" alt="Logotipo de Cooperativa Quinta Generación" width={72} height={72} priority />
        </div>
        <p className="eyebrow">SEGURIDAD DE TU CUENTA</p>
        <h1>Crea tu nueva contraseña</h1>
        <p className="login-copy">
          {access?.full_name ? `${access.full_name}, el` : "El"} administrador restableció tu contraseña. Elige una nueva contraseña que solo tú conozcas.
        </p>
        <PasswordForm forced />
        <button type="button" className="text-button account-signout" onClick={() => void signOut()}><LogOut size={15} /> Cerrar sesión</button>
      </section>
    </main>
  );
}
