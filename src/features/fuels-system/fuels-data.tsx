"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import {
  chlorineState,
  computeMonth,
  fmt,
  netTons,
  permitState,
  plantToday,
  supplierApproved,
  type FuelCoke,
  type FuelMonthSummary,
  type FuelProduct,
  type FuelReception,
  type FuelSchedule,
  type FuelSupplier,
} from "@/lib/fuels";
import { DATA_CHANGED_EVENT } from "@/lib/notifications";
import { useAuth } from "@/features/auth/auth-provider";
import { downloadCertificatePdf } from "@/features/fuels/certificate-pdf";
import { CokeModal } from "@/features/fuels/ecology-tab";
import { EntryModal, ExitModal } from "@/features/fuels/scale-modals";
import { ScheduleModal } from "@/features/fuels/schedule-modal";
import { SupplierModal } from "@/features/fuels/supplier-modal";
import { useNotify } from "@/shared/ui/notice-provider";

// Datos del sistema SCA (combustibles alternos): una sola carga compartida por todas las pantallas
// del menú lateral, con los mismos modales y reglas que el módulo original (src/features/fuels).

type Data = { today: string; suppliers: FuelSupplier[]; schedule: FuelSchedule[]; receptions: FuelReception[]; coke: FuelCoke[] };

export type FuelsDialog =
  | { type: "supplier"; supplier: FuelSupplier | null }
  | { type: "schedule" }
  | { type: "entry" }
  | { type: "exit"; reception: FuelReception }
  | { type: "closed"; reception: FuelReception }
  | { type: "coke"; month?: string }
  | null;

type FuelsContextValue = {
  loaded: boolean;
  error: string;
  reload: () => Promise<void>;
  today: string;
  suppliers: FuelSupplier[];
  schedule: FuelSchedule[];
  receptions: FuelReception[];
  coke: FuelCoke[];
  products: Map<number, FuelProduct>;
  summary: FuelMonthSummary;
  stats: { approved: number; expiring: number; inPlant: number; todayTons: number; agenda: number };
  perms: { suppliers: boolean; schedule: boolean; scale: boolean; commercial: boolean; ecology: boolean };
  open: (dialog: FuelsDialog) => void;
  printCertificate: (reception: FuelReception) => Promise<void>;
};

const FuelsContext = createContext<FuelsContextValue | null>(null);

export function useFuels(): FuelsContextValue {
  const value = useContext(FuelsContext);
  if (!value) throw new Error("useFuels debe usarse dentro de <FuelsDataProvider>.");
  return value;
}

export function FuelsDataProvider({ children }: { children: ReactNode }) {
  const { session, can, access } = useAuth();
  const notify = useNotify();
  const sessionRef = useRef(session);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<FuelsDialog>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const reload = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      setData(await requestApi<Data>(active, "/api/fuels/data"));
      setError("");
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    } catch (err) {
      setError(describeError(err, "No se pudo cargar el sistema de combustibles alternos."));
    }
  }, []);

  useEffect(() => {
    if (!session || !can("fuels.view")) return;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload, session, can]);

  const today = data?.today ?? plantToday();
  const suppliers = useMemo(() => data?.suppliers ?? [], [data]);
  const schedule = useMemo(() => data?.schedule ?? [], [data]);
  const receptions = useMemo(() => data?.receptions ?? [], [data]);
  const coke = useMemo(() => data?.coke ?? [], [data]);
  const products = useMemo(() => new Map<number, FuelProduct>(suppliers.flatMap((item) => item.products.map((product) => [product.id, product] as const))), [suppliers]);
  const summary = useMemo(() => computeMonth(today.slice(0, 7), receptions, schedule, products, coke), [today, receptions, schedule, products, coke]);
  const stats = useMemo(
    () => ({
      approved: suppliers.filter((item) => supplierApproved(item, today)).length,
      expiring: suppliers.filter((item) => item.status === "aprobado" && permitState(item.permit_valid_until, today).state !== "vigente").length,
      inPlant: receptions.filter((row) => row.status === "en_planta").length,
      todayTons: receptions.filter((row) => row.status === "cerrado" && row.received_on === today).reduce((sum, row) => sum + netTons(row), 0),
      agenda: schedule.filter((row) => row.scheduled_on === today && row.status === "programado").length,
    }),
    [suppliers, receptions, schedule, today],
  );
  const perms = useMemo(
    () => ({
      suppliers: can("fuels.suppliers"),
      schedule: can("fuels.schedule"),
      scale: can("fuels.scale"),
      commercial: can("fuels.commercial"),
      ecology: can("fuels.ecology"),
    }),
    [can],
  );

  const printCertificate = useCallback(
    async (reception: FuelReception) => {
      try {
        await downloadCertificatePdf(reception, chlorineState(reception, receptions, today), access?.full_name || access?.email || "SysNomQC");
      } catch (err) {
        console.error("No se pudo generar el certificado:", err);
        notify("error", "No se pudo generar el certificado", "Inténtalo de nuevo.");
      }
    },
    [receptions, today, access, notify],
  );

  const value = useMemo<FuelsContextValue>(
    () => ({ loaded: data !== null, error, reload, today, suppliers, schedule, receptions, coke, products, summary, stats, perms, open: setDialog, printCertificate }),
    [data, error, reload, today, suppliers, schedule, receptions, coke, products, summary, stats, perms, printCertificate],
  );

  const close = () => setDialog(null);

  return (
    <FuelsContext.Provider value={value}>
      {children}
      {dialog?.type === "supplier" && <SupplierModal supplier={dialog.supplier} onClose={close} onSaved={reload} />}
      {dialog?.type === "schedule" && (
        <ScheduleModal today={today} suppliers={suppliers} schedule={schedule} receptions={receptions} coke={coke} products={products} onClose={close} onSaved={reload} />
      )}
      {dialog?.type === "entry" && <EntryModal today={today} schedule={schedule} suppliers={suppliers} products={products} onClose={close} onSaved={reload} />}
      {dialog?.type === "exit" && (
        <ExitModal
          reception={dialog.reception}
          receptions={receptions}
          today={today}
          onClose={close}
          onClosed={async (closed) => {
            setDialog({ type: "closed", reception: closed });
            await reload();
          }}
        />
      )}
      {dialog?.type === "closed" && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="modal fuel-modal-small fuel-closed" role="dialog" aria-modal="true" aria-labelledby="sca-closed-title">
            <h2 id="sca-closed-title">Ticket {dialog.reception.id} cerrado</h2>
            <p>
              {dialog.reception.generator_name} · manifiesto {dialog.reception.manifest_folio}<br />
              Neto <strong>{fmt(dialog.reception.net_kg, 0)} kg</strong> ({fmt(netTons(dialog.reception), 3)} t)
            </p>
            <div className="modal-actions">
              <button className="button button-neutral" onClick={close}>Cerrar</button>
              <button className="button button-gold" onClick={() => void printCertificate(receptions.find((row) => row.id === dialog.reception.id && row.status === "cerrado") ?? dialog.reception)}>
                Imprimir certificado PDF
              </button>
            </div>
          </section>
        </div>
      )}
      {dialog?.type === "coke" && <CokeModal today={today} coke={coke} presetMonth={dialog.month} onClose={close} onSaved={reload} />}
    </FuelsContext.Provider>
  );
}
