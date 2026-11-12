-- Login con "usuario o correo": agrega un nombre de usuario opcional a las cuentas autorizadas.
-- Aditivo e idempotente: no modifica ni borra datos; las cuentas existentes siguen entrando con su correo.
-- Requiere 202611030001_create_employee_directory.sql.

alter table public.authorized_users add column if not exists username text;

-- Formato: 3 a 30 caracteres (letras, números, punto, guion y guion bajo); no puede parecer un correo.
alter table public.authorized_users drop constraint if exists authorized_users_username_format;
alter table public.authorized_users
  add constraint authorized_users_username_format
  check (username is null or username ~ '^[A-Za-z0-9._-]{3,30}$');

-- Único sin distinguir mayúsculas; varias cuentas pueden quedar sin usuario (NULL).
create unique index if not exists authorized_users_username_lower_key
  on public.authorized_users (lower(username))
  where username is not null;

-- La tabla sigue cerrada para anon/authenticated (solo lectura de la propia fila, ya definida).
-- La resolución usuario → correo se hace únicamente en el servidor con la llave service_role.

-- Opcional: asigna usuario a la cuenta del dueño si aún no tiene (cámbialo después desde /admin).
update public.authorized_users
set username = 'admin'
where username is null
  and lower(email) = 'crlos.trabajo.dev@gmail.com'
  and not exists (select 1 from public.authorized_users where lower(username) = 'admin');
