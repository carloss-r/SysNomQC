"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type NoticeTone = "success" | "error" | "warning" | "info";
type Notice = { id: number; tone: NoticeTone; title: string; message?: string };
type Notify = (tone: NoticeTone, title: string, message?: string) => void;

// Los errores duran más en pantalla para que dé tiempo de leerlos.
const NOTICE_DURATION: Record<NoticeTone, number> = {
  success: 4500,
  info: 4500,
  warning: 7000,
  error: 10000,
};

const NOTICE_ICONS = {
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
} as const;

const NoticeContext = createContext<Notify | null>(null);

export function useNotify(): Notify {
  const notify = useContext(NoticeContext);
  if (!notify) throw new Error("useNotify debe usarse dentro de <NoticeProvider>.");
  return notify;
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (tone, title, message) => {
      counter.current += 1;
      const id = counter.current;
      setNotices((current) => {
        // Un aviso idéntico que sigue en pantalla no se repite.
        if (current.some((notice) => notice.tone === tone && notice.title === title && notice.message === message)) return current;
        return [...current.slice(-3), { id, tone, title, message }];
      });
      window.setTimeout(() => dismiss(id), NOTICE_DURATION[tone]);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {notices.length > 0 && (
        <div className="toast-stack" aria-live="polite">
          {notices.map((notice) => {
            const Icon = NOTICE_ICONS[notice.tone];
            return (
              <div key={notice.id} className={`toast toast-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
                <Icon size={20} className="toast-icon" />
                <div className="toast-body">
                  <strong>{notice.title}</strong>
                  {notice.message && <p>{notice.message}</p>}
                </div>
                <button type="button" className="toast-close" onClick={() => dismiss(notice.id)} aria-label="Cerrar aviso"><X size={15} /></button>
              </div>
            );
          })}
        </div>
      )}
    </NoticeContext.Provider>
  );
}
