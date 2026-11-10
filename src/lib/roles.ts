// Los roles se guardan en la base con nombres legibles ("Encargado de compras"; migración
// 202611110001_normalizar_roles.sql). Este mapa cubre los nombres técnicos anteriores mientras
// una base aún no tenga esa migración, y roleLabel normaliza cualquier otro nombre en camelCase.
const LEGACY: Record<string, string> = {
  SuperAdmin: "Super administrador",
  AdminSede: "Administrador de sede",
  RecursosHumanos: "Recursos humanos",
  AlmacenistaEPP: "Almacenista de EPP",
  EncargadoCompras: "Encargado de compras",
  CombustiblesAlternos: "Combustibles alternos",
  OperadorBascula: "Operador de báscula",
  Ecologia: "Ecología",
  ContabilidadCombustibles: "Contabilidad de combustibles",
};

/** "EncargadoCompras" → "Encargado de compras"; un nombre ya escrito con espacios se deja igual. */
export function roleLabel(name: string | null | undefined): string {
  if (!name) return "Sin rol";
  if (LEGACY[name]) return LEGACY[name];
  if (/\s/.test(name)) return name;
  const words = name
    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, "$1 $2")
    .replace(/([A-ZÁÉÍÓÚÑ]+)([A-ZÁÉÍÓÚÑ][a-záéíóúñ])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    // Las siglas (EPP, RH) se quedan en mayúsculas.
    .map((word, index) => (word.length > 1 && word === word.toUpperCase() ? word : index === 0 ? word : word.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const roleLabels = (names: string[]) => (names.length ? names.map(roleLabel).join(" · ") : "Sin rol");
