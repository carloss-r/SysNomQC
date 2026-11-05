"use client";

import type { ReactNode } from "react";
import type { Permission } from "@/lib/permissions";
import { useAuth } from "@/features/auth/auth-provider";

// Protección de pantalla (solo experiencia de uso). La seguridad real está en la API y en las
// políticas RLS de la base de datos, que vuelven a validar el permiso en cada operación.
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="error-banner" role="alert">
        Tu rol no tiene permiso para ver esta pantalla.
      </div>
    );
  }
  return <>{children}</>;
}
