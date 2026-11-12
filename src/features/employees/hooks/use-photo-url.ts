"use client";

import { useEffect, useState } from "react";
import { getCachedPhotoUrl, getEmployeePhotoUrl } from "@/lib/photos";

/** URL temporal de una foto del bucket privado (undefined mientras carga o si no hay foto). */
export function usePhotoUrl(path: string | null | undefined): string | undefined {
  const [resolved, setResolved] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!path || getCachedPhotoUrl(path)) return;
    let active = true;
    void getEmployeePhotoUrl(path).then((url) => {
      if (active && url) setResolved((current) => ({ ...current, [path]: url }));
    });
    return () => {
      active = false;
    };
  }, [path]);

  if (!path) return undefined;
  return getCachedPhotoUrl(path) ?? resolved[path];
}
