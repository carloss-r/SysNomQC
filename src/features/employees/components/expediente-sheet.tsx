"use client";

import { createPortal } from "react-dom";
import { formatCurrency, formatDate, type Employee } from "@/lib/employees";

function rows(items: [string, string][]) {
  return (
    <table className="sheet-table">
      <tbody>
        {items.map(([label, value]) => (
          <tr key={label}><th>{label}</th><td>{value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

// Hoja imprimible del expediente. Se monta directamente en <body> (fuera del marco de la
// aplicación) y solo se muestra al imprimir o guardar como PDF. El membrete es únicamente el
// logotipo de la cooperativa.
export function ExpedienteSheet({ employee, photoUrl }: { employee: Employee; photoUrl?: string }) {
  return createPortal(
    <article className="print-sheet" aria-hidden="true">
      <header className="sheet-letterhead">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-cooperativa.jpg" alt="" />
      </header>

      <div className="sheet-title-row">
        <div>
          <h1>Expediente de personal</h1>
          <h2>{employee.full_name}</h2>
          <p>{employee.employee_code} · {employee.site} · {employee.active ? "Activo" : "Inactivo"}</p>
        </div>
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sheet-photo" src={photoUrl} alt="" />
        )}
      </div>

      <section>
        <h3>Información laboral</h3>
        {rows([
          ["ID empleado", employee.employee_code],
          ["Sede", employee.site],
          ["Área / puesto", employee.position],
          ["Fecha de contratación", formatDate(employee.hire_date)],
          ["Tipo de contrato", employee.contract_type],
          ["Salario actual", formatCurrency(employee.salary)],
          ["Cuenta bancaria", employee.bank_account || "No especificada"],
          ["Estatus", employee.active ? "Activo" : "Inactivo"],
        ])}
      </section>

      <section>
        <h3>Información personal</h3>
        {rows([
          ["Género", employee.gender || "No especificado"],
          ["Fecha de nacimiento", formatDate(employee.birth_date)],
          ["Estado civil", employee.marital_status || "No especificado"],
          ["NSS", employee.nss || "No especificado"],
          ["CURP", employee.curp || "No especificada"],
          ["RFC", employee.rfc || "No especificado"],
          ["Créditos activos", employee.credits.length ? employee.credits.join(", ") : "Ninguno"],
        ])}
      </section>

      <section>
        <h3>Contacto y domicilio</h3>
        {rows([
          ["Correo electrónico", employee.email || "No especificado"],
          ["Teléfono", employee.phone || "No especificado"],
          ["Estado de residencia", employee.residence_state || "No especificado"],
          ["Dirección", employee.address || "No especificada"],
        ])}
      </section>

      <footer className="sheet-footer">
        Generado el {new Intl.DateTimeFormat("es-MX", { dateStyle: "long" }).format(new Date())}
      </footer>
    </article>,
    document.body,
  );
}
