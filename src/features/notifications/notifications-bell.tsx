"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useNotifications } from "./notifications-provider";

// La campana solo cuenta lo grave e importante; lo de menor importancia no debe generar ruido.
export function NotificationsBell() {
  const { active } = useNotifications();
  const urgent = active.filter((item) => item.severity !== "minor");
  const hasCritical = urgent.some((item) => item.severity === "critical");
  const label = urgent.length === 0 ? "Notificaciones" : `Notificaciones: ${urgent.length} por atender`;

  return (
    <Link className="icon-button topbar-icon bell-button" href="/notificaciones" aria-label={label} title={label}>
      <Bell size={18} />
      {urgent.length > 0 && (
        <span className={`bell-count${hasCritical ? " bell-count-critical" : ""}`} aria-hidden="true">
          {urgent.length > 99 ? "99+" : urgent.length}
        </span>
      )}
    </Link>
  );
}
