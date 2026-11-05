import { Suspense } from "react";
import { EppView } from "@/features/epp/epp-view";

// Suspense: la pantalla lee ?sede= y ?tab= de la dirección (useSearchParams).
export default function Page() {
  return (
    <Suspense fallback={null}>
      <EppView />
    </Suspense>
  );
}
