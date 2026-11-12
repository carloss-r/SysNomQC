"use client";

import { BriefcaseBusiness, Download, FileText, MapPin, Pencil, Trash2, UserRound, X } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { formatCurrency, formatDate, type Employee } from "@/lib/employees";
import { Avatar, StatusBadge } from "@/shared/ui/badges";
import { usePhotoUrl } from "../hooks/use-photo-url";
import { ExpedienteSheet } from "./expediente-sheet";

function ProfileSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="profile-section"><h3>{icon}{title}</h3><div className="profile-grid">{children}</div></section>;
}

function ProfileValue({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`profile-value${wide ? " profile-value-wide" : ""}`}><span>{label}</span><strong>{children}</strong></div>;
}

// "Descargar expediente": abre la impresión con la hoja del expediente (logo como membrete);
// desde ahí se imprime o se guarda como PDF.
function printExpediente(employee: Employee) {
  const previousTitle = document.title;
  document.title = `Expediente ${employee.employee_code} - ${employee.full_name}`;
  const restoreTitle = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restoreTitle);
  };
  window.addEventListener("afterprint", restoreTitle);
  window.print();
}

export function EmployeeProfileModal({
  employee,
  onClose,
  onEdit,
  onDelete,
}: {
  employee: Employee;
  onClose: () => void;
  onEdit: (employee: Employee) => void;
  onDelete: (employee: Employee) => void;
}) {
  const { can } = useAuth();
  const photoUrl = usePhotoUrl(employee.photo_path);

  return (
    <>
      <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
          <div className="profile-header">
            <button className="icon-button profile-close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
            <Avatar name={employee.full_name} photoUrl={photoUrl} large />
            <div className="profile-identity">
              <div className="profile-title-row">
                <h2 id="profile-title">{employee.full_name}</h2>
                <StatusBadge active={employee.active} />
              </div>
              <p>{employee.position}</p>
              <div className="profile-tags"><span><FileText size={13} /> {employee.employee_code}</span><span><MapPin size={13} /> {employee.site}</span></div>
            </div>
          </div>
          <div className="profile-body">
            <ProfileSection title="Información laboral" icon={<BriefcaseBusiness size={16} />}>
              <ProfileValue label="Fecha de contratación">{formatDate(employee.hire_date)}</ProfileValue>
              <ProfileValue label="Tipo de contrato">{employee.contract_type}</ProfileValue>
              <ProfileValue label="Salario actual">{formatCurrency(employee.salary)}</ProfileValue>
              <ProfileValue label="Cuenta bancaria">{employee.bank_account || "No especificada"}</ProfileValue>
              <ProfileValue label="Estatus">{employee.active ? "Activo" : "Inactivo"}</ProfileValue>
            </ProfileSection>
            <ProfileSection title="Información personal" icon={<UserRound size={16} />}>
              <ProfileValue label="Género">{employee.gender || "No especificado"}</ProfileValue>
              <ProfileValue label="Fecha de nacimiento">{formatDate(employee.birth_date)}</ProfileValue>
              <ProfileValue label="Estado civil">{employee.marital_status || "No especificado"}</ProfileValue>
              <ProfileValue label="NSS">{employee.nss || "No especificado"}</ProfileValue>
              <ProfileValue label="CURP">{employee.curp || "No especificada"}</ProfileValue>
              <ProfileValue label="RFC">{employee.rfc || "No especificado"}</ProfileValue>
              <ProfileValue label="Créditos activos">{employee.credits.length ? employee.credits.join(", ") : "Ninguno"}</ProfileValue>
            </ProfileSection>
            <ProfileSection title="Contacto y domicilio" icon={<MapPin size={16} />}>
              <ProfileValue label="Correo electrónico">{employee.email || "No especificado"}</ProfileValue>
              <ProfileValue label="Teléfono">{employee.phone || "No especificado"}</ProfileValue>
              <ProfileValue label="Estado de residencia">{employee.residence_state || "No especificado"}</ProfileValue>
              <ProfileValue label="Dirección" wide>{employee.address || "No especificada"}</ProfileValue>
            </ProfileSection>
          </div>
          <div className="modal-actions profile-actions">
            {can("employees.delete") && <button className="button button-danger-outline" onClick={() => onDelete(employee)}><Trash2 size={16} /> Eliminar</button>}
            <span className="actions-spacer" />
            {can("employees.download") && <button className="button button-outline" onClick={() => printExpediente(employee)}><Download size={16} /> Descargar expediente</button>}
            <button className="button button-neutral" onClick={onClose}>Cerrar</button>
            {can("employees.edit") && <button className="button button-gold" onClick={() => onEdit(employee)}><Pencil size={16} /> Editar expediente</button>}
          </div>
        </section>
      </div>
      {can("employees.download") && <ExpedienteSheet employee={employee} photoUrl={photoUrl} />}
    </>
  );
}
