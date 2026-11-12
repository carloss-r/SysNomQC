import Link from "next/link";

export default function NotFound() {
  return (
    <main className="screen-center">
      <h1>Página no encontrada</h1>
      <p>La dirección que buscas no existe.</p>
      <Link className="button button-primary" href="/">Ir al inicio</Link>
    </main>
  );
}
