import type { LucideIcon } from "lucide-react";
import { Building2, CalendarDays, Gauge, Leaf, Receipt, Scale } from "lucide-react";
import type { Permission } from "@/lib/permissions";

/** Ruta base del sistema de combustibles alternos (SCA). No aparece en el menú del sistema principal. */
export const SCA_BASE = "/sca";

export type ScaNavItem = { href: string; label: string; hint: string; icon: LucideIcon; permission: Permission; exact?: boolean };
export type ScaNavSection = { title: string; items: ScaNavItem[] };

// Mismos módulos y permisos que la pantalla "Combustibles alternos" del sistema principal,
// ahora cada uno en su propia pantalla.
export const SCA_NAVIGATION: ScaNavSection[] = [
  {
    title: "Tablero",
    items: [{ href: SCA_BASE, label: "Panel de control", hint: "Semáforo, planta y alertas", icon: Gauge, permission: "fuels.view", exact: true }],
  },
  {
    title: "Operación",
    items: [
      { href: `${SCA_BASE}/bascula`, label: "Báscula", hint: "M3 · Manifiestos y pesaje", icon: Scale, permission: "fuels.view" },
      { href: `${SCA_BASE}/programacion`, label: "Programación", hint: "M2 · Agenda logística", icon: CalendarDays, permission: "fuels.view" },
    ],
  },
  {
    title: "Expedientes",
    items: [{ href: `${SCA_BASE}/proveedores`, label: "Proveedores", hint: "M1 · Homologación", icon: Building2, permission: "fuels.view" }],
  },
  {
    title: "Control",
    items: [
      { href: `${SCA_BASE}/comercial`, label: "Comercial", hint: "M4 · Contabilidad", icon: Receipt, permission: "fuels.commercial" },
      { href: `${SCA_BASE}/ecologia`, label: "Ecología", hint: "M5 · Sustitución térmica", icon: Leaf, permission: "fuels.view" },
    ],
  },
];

export function findScaItem(pathname: string): ScaNavItem | undefined {
  const items = SCA_NAVIGATION.flatMap((section) => section.items);
  return items.find((item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)));
}
