import type { ReactNode } from "react";

export function StatCard({ label, count, tone, icon }: { label: string; count: number; tone: string; icon: ReactNode }) {
  return <div className={`stat-card stat-${tone}`}><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><strong>{count}</strong></div>;
}

export function SiteBadge({ site }: { site: string }) {
  const tone = site === "Campeche" ? "site-blue" : site === "Lagunas" ? "site-gold" : site === "Cruz Azul" ? "site-purple" : site === "El Carmen" ? "site-teal" : "site-neutral";
  return <span className={`site-badge ${tone}`}>{site}</span>;
}

export function StatusBadge({ active }: { active: boolean }) {
  return <span className={`status-badge ${active ? "status-active" : "status-inactive"}`}><span />{active ? "Activo" : "Baja"}</span>;
}

export function Avatar({ name, photoUrl, large = false }: { name: string; photoUrl?: string; large?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <span className={`avatar${large ? " avatar-large" : ""}`}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={`Fotografía de ${name}`} />
      ) : (
        initials
      )}
    </span>
  );
}
