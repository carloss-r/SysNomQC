"use client";

import { RouteError } from "@/shared/layout/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError area="EPP" error={error} reset={reset} />;
}
