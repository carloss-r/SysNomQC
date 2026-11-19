-- Mi cuenta y restablecer contraseña. Ejecutar DESPUÉS de 202611170004_epp_compra_directa.sql. Es seguro repetirla.
--
-- * phone: teléfono de contacto que cada usuario puede capturar en "Mi cuenta" (opcional).
-- * must_change_password: el Super administrador restableció la contraseña con una temporal; al entrar,
--   la cuenta debe cambiarla antes de usar el sistema. Se apaga sola cuando el usuario pone la suya.
--
-- Los cambios de "Mi cuenta" los hace el servidor con la llave service_role y solo sobre la fila de la
-- propia cuenta (nombre, usuario y teléfono); rol, sede y estatus siguen siendo solo del administrador.

alter table public.authorized_users add column if not exists phone text;
alter table public.authorized_users drop constraint if exists authorized_users_phone_format;
alter table public.authorized_users
  add constraint authorized_users_phone_format
  check (phone is null or phone ~ '^[0-9 +()-]{7,20}$');

alter table public.authorized_users add column if not exists must_change_password boolean not null default false;
comment on column public.authorized_users.must_change_password is
  'true = contraseña temporal puesta por el administrador; la cuenta debe cambiarla al iniciar sesión.';

notify pgrst, 'reload schema';
