"use client";

import { Moon, Sun } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "./theme-init";

const CHANGE_EVENT = "sysnomqc-theme-change";

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

const isDark = () => document.documentElement.dataset.theme === "dark";

// El tema claro es el predeterminado; el oscuro solo se activa si la persona lo elige.
export function ThemeToggle({ variant = "icon", tabIndex }: { variant?: "icon" | "menu"; tabIndex?: number }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  const toggle = useCallback(() => {
    const next = !isDark();
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      if (next) window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      else window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Sin almacenamiento disponible: el cambio dura hasta recargar la página.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const label = dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  if (variant === "menu") {
    return (
      <button type="button" className="nav-link nav-button" onClick={toggle} tabIndex={tabIndex}>
        {dark ? <Sun size={18} /> : <Moon size={18} />}
        <span>{dark ? "Modo claro" : "Modo oscuro"}</span>
      </button>
    );
  }

  return (
    <button type="button" className="icon-button topbar-icon hide-phone" onClick={toggle} aria-label={label} title={label}>
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
