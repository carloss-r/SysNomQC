"use client";

import { FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { useNotify } from "@/shared/ui/notice-provider";
import { downloadReportPdf, downloadReportXlsx, type Report } from "./report-export";

/** Botones "PDF" y "Excel" para descargar el mismo reporte en el formato que se prefiera. */
export function ExportButtons({
  build,
  disabled,
  className,
}: {
  build: (generatedBy: string) => Report;
  disabled?: boolean;
  className?: string;
}) {
  const { access } = useAuth();
  const notify = useNotify();
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);

  async function run(format: "pdf" | "xlsx") {
    setBusy(format);
    try {
      const report = build(access?.full_name || access?.email || "SysNomQC");
      if (format === "pdf") await downloadReportPdf(report);
      else await downloadReportXlsx(report);
    } catch (err) {
      console.error("No se pudo generar el archivo:", err);
      notify("error", `No se pudo generar el ${format === "pdf" ? "PDF" : "Excel"}`, "Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`epp-export${className ? ` ${className}` : ""}`} role="group" aria-label="Descargar reporte">
      <span className="epp-export-label">Descargar:</span>
      <button type="button" className="button button-outline" onClick={() => void run("pdf")} disabled={disabled || busy !== null} title="Descargar en PDF">
        <FileText size={16} /> {busy === "pdf" ? "Generando…" : "PDF"}
      </button>
      <button type="button" className="button button-outline" onClick={() => void run("xlsx")} disabled={disabled || busy !== null} title="Descargar en Excel">
        <FileSpreadsheet size={16} /> {busy === "xlsx" ? "Generando…" : "Excel"}
      </button>
    </div>
  );
}
