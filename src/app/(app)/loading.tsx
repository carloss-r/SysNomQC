import { LoadingState } from "@/shared/ui/loading";

export default function Loading() {
  return (
    <main className="main-content">
      <LoadingState label="Cargando…" rows={5} />
    </main>
  );
}
