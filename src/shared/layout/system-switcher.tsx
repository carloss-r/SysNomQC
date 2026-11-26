"use client";

import { Check, CircleHelp, Flame, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { SCA_BASE, SCA_HOME } from "@/features/fuels-system/navigation";

// Botón "?" de la barra superior: cambia entre el sistema principal y el de combustibles alternos (SCA).
// El SCA no aparece en ningún menú; solo se llega por aquí o con el enlace directo.
// El botón solo existe para cuentas con el rol de combustibles (fuels.view).
export function SystemSwitcher({ buttonClassName = "" }: { buttonClassName?: string }) {
  const { can } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inSca = pathname === SCA_BASE || pathname.startsWith(`${SCA_BASE}/`);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!can("fuels.view")) return null;

  const systems = [
    { href: "/personal", label: "Gestión de Personal", hint: "Empleados, EPP, facturas y administración", icon: UsersRound, current: !inSca, show: true },
    { href: SCA_HOME, label: "Combustibles Alternos · SCA", hint: "Báscula, agenda, proveedores y semáforo SEMARNAT", icon: Flame, current: inSca, show: can("fuels.view") },
  ].filter((item) => item.show);

  return (
    <div className="system-switcher" ref={rootRef}>
      <button
        type="button"
        className={`icon-button system-switcher-button ${buttonClassName}`}
        onClick={() => setOpen((value) => !value)}
        aria-label="Cambiar de sistema"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Cambiar de sistema"
      >
        <CircleHelp size={19} />
      </button>
      {open && (
        <div className="system-switcher-menu" role="menu">
          <p className="system-switcher-title">Cambiar de sistema</p>
          {systems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                className={`system-switcher-item${item.current ? " current" : ""}`}
                aria-current={item.current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <span className="system-switcher-icon"><Icon size={18} /></span>
                <span className="system-switcher-copy">
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
                {item.current && <Check size={16} className="system-switcher-check" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
