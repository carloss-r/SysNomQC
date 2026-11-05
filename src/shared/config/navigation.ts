import type { LucideIcon } from "lucide-react";
import { HardHat, ShieldCheck, UsersRound } from "lucide-react";
import type { Permission } from "@/lib/permissions";

// Para agregar una pantalla nueva:
//   1. Crea la carpeta src/app/(app)/<ruta>/ con page.tsx y error.tsx.
//   2. Pon su lógica en src/features/<modulo>/.
//   3. Agrega una entrada aquí (el menú lateral la muestra solo a quien tenga el permiso).

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Permiso necesario para ver el elemento en el menú. Sin permiso = visible para toda cuenta autorizada. */
  permission?: Permission;
  /** Solo se marca activo cuando la ruta coincide exactamente (p. ej. el inicio). */
  exact?: boolean;
};

export type NavSection = { title: string; items: NavItem[] };

export const NAVIGATION: NavSection[] = [
  {
    title: "Personal",
    items: [{ href: "/", label: "Empleados", icon: UsersRound, permission: "employees.view", exact: true }],
  },
  {
    title: "Seguridad e higiene",
    items: [{ href: "/epp", label: "EPP", icon: HardHat, permission: "epp.view" }],
  },
  {
    title: "Administración",
    items: [{ href: "/admin", label: "Usuarios y roles", icon: ShieldCheck, permission: "users.manage" }],
  },
];
