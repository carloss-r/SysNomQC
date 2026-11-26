import type { Metadata } from "next";
import { EmployeesView } from "@/features/employees/employees-view";
import { SITE_NAME } from "@/lib/site";

// La portada es lo único que Google puede indexar: sin sesión muestra el inicio de sesión.
export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} · Sistema interno` },
  alternates: { canonical: "/" },
  robots: { index: true, follow: false, nocache: true },
};

export default function Page() {
  return <EmployeesView />;
}
