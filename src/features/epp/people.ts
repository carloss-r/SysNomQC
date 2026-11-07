import type { EppMovement } from "@/lib/permissions";

/** Minúsculas y sin acentos, para comparar nombres y búsquedas. */
export const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export type Person = {
  key: string;
  name: string;
  employeeId: string | null;
  group: string | null;
  position: string | null;
  pieces: number;
  deliveries: number;
  lastDate: string;
};

/** Trabajadores con entregas registradas (una persona por nombre, sin importar acentos o mayúsculas). */
export function buildPeople(movements: EppMovement[]): Person[] {
  const map = new Map<string, Person>();
  for (const row of movements) {
    if (row.kind !== "entrega" || !row.employee_name) continue;
    const key = normalize(row.employee_name);
    const current = map.get(key);
    const pieces = Math.abs(row.delta);
    if (!current) {
      map.set(key, {
        key,
        name: row.employee_name,
        employeeId: row.employee_id,
        group: row.employee_group,
        position: row.employee_position,
        pieces,
        deliveries: 1,
        lastDate: row.moved_on,
      });
      continue;
    }
    current.pieces += pieces;
    current.deliveries += 1;
    if (row.moved_on > current.lastDate) current.lastDate = row.moved_on;
    current.employeeId ??= row.employee_id;
    current.group ??= row.employee_group;
    current.position ??= row.employee_position;
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function monthKey(day: string) {
  return day.slice(0, 7);
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}
