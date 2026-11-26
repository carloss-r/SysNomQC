import type { Metadata } from "next";
import { EmployeesView } from "@/features/employees/employees-view";

export const metadata: Metadata = { title: "Gestión de Personal" };

export default function Page() {
  return <EmployeesView />;
}
