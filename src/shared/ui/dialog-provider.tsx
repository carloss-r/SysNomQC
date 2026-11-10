"use client";

import { CircleHelp, PencilLine, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// Diálogos del sistema que reemplazan a window.confirm y window.prompt del navegador
// (mismo estilo que las ventanas de la app). Se usan con await:
//   const ok = await dialog.confirm({ title: "¿Eliminar?", tone: "danger" });
//   const reason = await dialog.prompt({ title: "Motivo", required: true });  // null = canceló

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" para acciones que borran o cancelan. */
  tone?: "default" | "danger";
};

type PromptOptions = ConfirmOptions & {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  inputMode?: "text" | "decimal" | "numeric";
  multiline?: boolean;
  /** Devuelve un mensaje de error o null si el valor es válido. */
  validate?: (value: string) => string | null;
};

type Dialogs = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

type Pending =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

const DialogContext = createContext<Dialogs | null>(null);

export function useDialog(): Dialogs {
  const dialogs = useContext(DialogContext);
  if (!dialogs) throw new Error("useDialog debe usarse dentro de <DialogProvider>.");
  return dialogs;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Pending[]>([]);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setQueue((current) => [...current, { kind: "confirm", options, resolve }])),
    [],
  );
  const prompt = useCallback(
    (options: PromptOptions) => new Promise<string | null>((resolve) => setQueue((current) => [...current, { kind: "prompt", options, resolve }])),
    [],
  );
  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  const current = queue[0] ?? null;
  const close = useCallback((result: boolean | string | null) => {
    setQueue((list) => {
      const [first, ...rest] = list;
      if (first?.kind === "confirm") first.resolve(result === true);
      else if (first?.kind === "prompt") first.resolve(typeof result === "string" ? result : null);
      return rest;
    });
  }, []);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {current && <SystemDialog key={queue.length} pending={current} onClose={close} />}
    </DialogContext.Provider>
  );
}

function SystemDialog({ pending, onClose }: { pending: Pending; onClose: (result: boolean | string | null) => void }) {
  const { options } = pending;
  const prompt = pending.kind === "prompt" ? pending.options : null;
  const danger = options.tone === "danger";
  const [text, setText] = useState(prompt?.defaultValue ?? "");
  const [error, setError] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const cancelValue = pending.kind === "confirm" ? false : null;

  useEffect(() => {
    (prompt ? inputRef.current : confirmRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose(cancelValue);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [prompt, onClose, cancelValue]);

  function accept() {
    if (!prompt) return onClose(true);
    const value = text.trim();
    if (prompt.required && !value) return setError("Este dato es obligatorio.");
    const problem = prompt.validate?.(value) ?? null;
    if (problem) return setError(problem);
    onClose(value);
  }

  const Icon = danger ? TriangleAlert : prompt ? PencilLine : CircleHelp;
  const inputProps = {
    id: "system-dialog-input",
    value: text,
    onChange: (event: { target: { value: string } }) => { setText(event.target.value); setError(""); },
    placeholder: prompt?.placeholder,
    maxLength: prompt?.maxLength ?? 300,
    "aria-invalid": error ? true : undefined,
  };

  return (
    <div className="modal-backdrop system-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(cancelValue); }}>
      <section className="modal system-dialog" role="alertdialog" aria-modal="true" aria-labelledby="system-dialog-title" aria-describedby={options.message ? "system-dialog-message" : undefined}>
        <div className="modal-header">
          <div className={`modal-heading-icon${danger ? " system-dialog-danger" : ""}`}><Icon size={19} /></div>
          <h2 id="system-dialog-title">{options.title}</h2>
          <button type="button" className="icon-button close-modal" onClick={() => onClose(cancelValue)} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="system-dialog-body" onSubmit={(event) => { event.preventDefault(); accept(); }} noValidate>
          {options.message && <div id="system-dialog-message" className="system-dialog-message">{options.message}</div>}
          {prompt && (
            <label className="field" htmlFor="system-dialog-input">
              {prompt.label && <span className="field-label">{prompt.label}{prompt.required && <span className="required-mark"> *</span>}</span>}
              {prompt.multiline ? <textarea ref={inputRef} rows={3} {...inputProps} /> : <input ref={inputRef} inputMode={prompt.inputMode} {...inputProps} />}
            </label>
          )}
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={() => onClose(cancelValue)}>{options.cancelLabel ?? "Cancelar"}</button>
            <button ref={confirmRef} type="submit" className={`button ${danger ? "button-danger" : "button-gold"}`}>{options.confirmLabel ?? "Aceptar"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
