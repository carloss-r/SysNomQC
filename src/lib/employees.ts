// Sede, área, puesto, género, estado civil y tipos de crédito viven en catálogos de la base
// de datos (se cargan desde /api/catalogs). Aquí solo quedan los valores que no son catálogo.
export const CONTRACT_TYPES = [
  "Indeterminado (Planta)",
  "Determinado (Eventual)",
  "Prueba / Capacitación",
] as const;

export type CatalogItem = { id: number; name: string };
export type PositionItem = CatalogItem & { area_id: number };

export type Catalogs = {
  sites: CatalogItem[];
  areas: CatalogItem[];
  positions: PositionItem[];
  genders: CatalogItem[];
  marital_statuses: CatalogItem[];
  credit_types: CatalogItem[];
};

export type EmployeeCredit = {
  credit_type_id: number;
  credit_type: string;
  credit_number: string;
  monthly_discount: number;
  status: string;
};

export type Employee = {
  id: number;
  employee_code: string;
  full_name: string;
  site_id: number;
  site: string;
  area_id: number;
  area: string;
  position_id: number;
  position: string;
  hire_date: string;
  contract_type: string;
  salary: number;
  bank_account: string | null;
  clabe: string | null;
  active: boolean;
  gender_id: number | null;
  gender: string | null;
  marital_status_id: number | null;
  marital_status: string | null;
  nss: string | null;
  curp: string | null;
  rfc: string | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  residence_state: string | null;
  residence_city: string | null;
  postal_code: string | null;
  address: string | null;
  /** Ruta del archivo dentro del bucket privado "employee-photos" de Supabase. */
  photo_path: string | null;
  credits: EmployeeCredit[];
  created_at: string | null;
  updated_at: string | null;
};

// La tabla principal solo necesita estos datos: la lista viaja ligera y el expediente
// completo (salario, CURP, NSS, etc.) se pide únicamente al abrir un empleado.
export type EmployeeSummary = Pick<
  Employee,
  "id" | "employee_code" | "full_name" | "site" | "area" | "position" | "contract_type" | "active" | "email"
>;

export const positionLabel = (employee: Pick<Employee, "area" | "position">) =>
  `${employee.area} - ${employee.position}`;

export const toEmployeeSummary = (employee: Employee): EmployeeSummary => ({
  id: employee.id,
  employee_code: employee.employee_code,
  full_name: employee.full_name,
  site: employee.site,
  area: employee.area,
  position: employee.position,
  contract_type: employee.contract_type,
  active: employee.active,
  email: employee.email,
});

export const sortEmployees = (list: EmployeeSummary[]) =>
  [...list].sort((a, b) => a.full_name.localeCompare(b.full_name, "es-MX"));

export type EmployeeCreditInput = {
  credit_type_id: number;
  credit_number: string | null;
  monthly_discount: number;
};

/** Lo que el navegador envía a la API (referencias a catálogos por id). */
export type EmployeeInput = {
  employee_code: string;
  full_name: string;
  site_id: number;
  position_id: number;
  hire_date: string;
  contract_type: string;
  salary: number;
  bank_account: string | null;
  clabe: string | null;
  active: boolean;
  gender_id: number | null;
  marital_status_id: number | null;
  nss: string | null;
  curp: string | null;
  rfc: string | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  residence_state: string | null;
  residence_city: string | null;
  postal_code: string | null;
  address: string | null;
  photo_path: string | null;
  credits: EmployeeCreditInput[];
};

export type CreditFormValue = {
  credit_type_id: number;
  credit_number: string;
  monthly_discount: string;
};

export type EmployeeFormValues = {
  employee_code: string;
  full_name: string;
  site_id: string;
  area_id: string;
  position_id: string;
  hire_date: string;
  contract_type: string;
  salary: string;
  bank_account: string;
  clabe: string;
  active: boolean;
  gender_id: string;
  marital_status_id: string;
  nss: string;
  curp: string;
  rfc: string;
  birth_date: string;
  credits: CreditFormValue[];
  email: string;
  phone: string;
  residence_state: string;
  residence_city: string;
  postal_code: string;
  address: string;
};

export const EMPTY_EMPLOYEE_FORM: EmployeeFormValues = {
  employee_code: "",
  full_name: "",
  site_id: "",
  area_id: "",
  position_id: "",
  hire_date: "",
  contract_type: CONTRACT_TYPES[0],
  salary: "",
  bank_account: "",
  clabe: "",
  active: true,
  gender_id: "",
  marital_status_id: "",
  nss: "",
  curp: "",
  rfc: "",
  birth_date: "",
  credits: [],
  email: "",
  phone: "",
  residence_state: "",
  residence_city: "",
  postal_code: "",
  address: "",
};

const optionalValue = (value: string) => value.trim() || null;
const optionalId = (value: string) => (value ? Number(value) : null);

export function formToEmployeeInput(
  form: EmployeeFormValues,
  photoPath: string | null,
): EmployeeInput {
  return {
    employee_code: form.employee_code.trim().toUpperCase(),
    full_name: form.full_name.trim(),
    site_id: Number(form.site_id),
    position_id: Number(form.position_id),
    hire_date: form.hire_date,
    contract_type: form.contract_type,
    salary: Number(form.salary) || 0,
    bank_account: optionalValue(form.bank_account),
    clabe: optionalValue(form.clabe),
    active: form.active,
    gender_id: optionalId(form.gender_id),
    marital_status_id: optionalId(form.marital_status_id),
    nss: optionalValue(form.nss),
    curp: optionalValue(form.curp)?.toUpperCase() ?? null,
    rfc: optionalValue(form.rfc)?.toUpperCase() ?? null,
    birth_date: optionalValue(form.birth_date),
    email: optionalValue(form.email),
    phone: optionalValue(form.phone),
    residence_state: optionalValue(form.residence_state),
    residence_city: optionalValue(form.residence_city),
    postal_code: optionalValue(form.postal_code),
    address: optionalValue(form.address),
    photo_path: photoPath,
    credits: form.credits.map((credit) => ({
      credit_type_id: credit.credit_type_id,
      credit_number: optionalValue(credit.credit_number),
      monthly_discount: Number(credit.monthly_discount) || 0,
    })),
  };
}

export function employeeToForm(employee: Employee): EmployeeFormValues {
  return {
    employee_code: employee.employee_code,
    full_name: employee.full_name,
    site_id: String(employee.site_id),
    area_id: String(employee.area_id),
    position_id: String(employee.position_id),
    hire_date: employee.hire_date,
    contract_type: employee.contract_type,
    salary: String(employee.salary),
    bank_account: employee.bank_account ?? "",
    clabe: employee.clabe ?? "",
    active: employee.active,
    gender_id: employee.gender_id ? String(employee.gender_id) : "",
    marital_status_id: employee.marital_status_id ? String(employee.marital_status_id) : "",
    nss: employee.nss ?? "",
    curp: employee.curp ?? "",
    rfc: employee.rfc ?? "",
    birth_date: employee.birth_date ?? "",
    credits: employee.credits.map((credit) => ({
      credit_type_id: credit.credit_type_id,
      credit_number: credit.credit_number === "S/N" ? "" : credit.credit_number,
      monthly_discount: credit.monthly_discount ? String(credit.monthly_discount) : "",
    })),
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    residence_state: employee.residence_state ?? "",
    residence_city: employee.residence_city ?? "",
    postal_code: employee.postal_code ?? "",
    address: employee.address ?? "",
  };
}

export function formatDate(date: string | null) {
  if (!date) return "No especificada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Texto de los créditos para el expediente: "Fonacot (No. 123) · $500.00 al mes". */
export function describeCredit(credit: EmployeeCredit) {
  const number = credit.credit_number && credit.credit_number !== "S/N" ? ` (No. ${credit.credit_number})` : "";
  const discount = credit.monthly_discount > 0 ? ` · ${formatCurrency(credit.monthly_discount)} al mes` : "";
  return `${credit.credit_type}${number}${discount}`;
}
