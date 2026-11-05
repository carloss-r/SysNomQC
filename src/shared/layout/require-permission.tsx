"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import type { Permission } from "@/lib/permissions";
import { useAuth } from "@/features/auth/auth-provider";
import { NAVIGATION } from "@/shared/config/navigation";

/** Primera pantalla del menú a la que la cuenta tiene acceso (si no tiene ninguna, sus notificaciones). */
export function useHomePath(): string {
  const { can } = useAuth();
  const first = NAVIGATION.flatMap((section) => section.items).find((item) => !item.permission || can(item.permission));
  return first?.href ?? "/notificaciones";
}

// Protección de pantalla (solo experiencia de uso). La seguridad real está en la API y en las
// políticas RLS de la base de datos, que vuelven a validar el permiso en cada operación.
// Sin permiso, la cuenta se lleva a su propia pantalla en lugar de mostrarle un error.
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const home = useHomePath();
  const allowed = can(permission);
  const redirect = !allowed && home !== pathname;

  useEffect(() => {
    if (redirect) router.replace(home);
  }, [redirect, home, router]);

  if (allowed) return <>{children}</>;
  if (redirect) return <div className="table-state"><span className="spinner" /> Abriendo tu pantalla…</div>;
  return (
    <div className="error-banner" role="alert">
      Tu rol no tiene permiso para ver esta pantalla.
    </div>
  );
}
