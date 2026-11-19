import { redirect } from "next/navigation";
import { SCA_HOME } from "@/features/fuels-system/navigation";

// El SCA abre directamente en Proveedores.
export default function Page() {
  redirect(SCA_HOME);
}
