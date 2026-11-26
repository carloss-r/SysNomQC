import { ArrowRight, Clock, Flame, HardHat, Leaf, LockKeyhole, Mail, MapPin, Phone, UsersRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { LANDING } from "./content";
import "./landing.css";

const ICONS = { users: UsersRound, flame: Flame, shield: HardHat, leaf: Leaf } as const;
const SYSTEM_PATH = "/personal";

/** Página pública: lo único que ve quien no es del personal y lo único que indexa Google. */
export function LandingPage() {
  const { hero, about, services, values, contact } = LANDING;
  const year = new Date().getFullYear();
  const contactRows = [
    { icon: MapPin, label: "Dirección", value: contact.address, href: contact.mapsUrl || undefined },
    { icon: Phone, label: "Teléfono", value: contact.phone, href: contact.phone ? `tel:${contact.phone.replace(/[^\d+]/g, "")}` : undefined },
    { icon: Mail, label: "Correo", value: contact.email, href: contact.email ? `mailto:${contact.email}` : undefined },
    { icon: Clock, label: "Horario", value: contact.hours, href: undefined },
  ].filter((row) => row.value);

  return (
    <div className="landing">
      <header className="landing-header">
        <a className="landing-brand" href="#inicio">
          <Image src="/logo-cooperativa.jpg" alt="" width={40} height={40} priority />
          <span>Quinta Generación</span>
        </a>
        <nav className="landing-nav" aria-label="Secciones">
          <a href="#nosotros">Nosotros</a>
          <a href="#servicios">Servicios</a>
          <a href="#valores">Valores</a>
          <a href="#contacto">Contacto</a>
        </nav>
        <Link className="landing-access" href={SYSTEM_PATH} prefetch={false}>
          <LockKeyhole size={15} /> Acceso al personal
        </Link>
      </header>

      <main>
        <section className="landing-hero" id="inicio">
          <div className="landing-hero-text">
            <p className="landing-eyebrow">{hero.eyebrow}</p>
            <h1>{hero.title}</h1>
            <p className="landing-lead">{hero.lead}</p>
            <div className="landing-actions">
              <a className="landing-button primary" href="#servicios">Conoce lo que hacemos <ArrowRight size={16} /></a>
              <a className="landing-button ghost" href="#contacto">Contáctanos</a>
            </div>
          </div>
          <div className="landing-hero-logo">
            <Image src="/logo-cooperativa.jpg" alt="Logotipo de la Cooperativa Quinta Generación" width={260} height={260} priority />
          </div>
        </section>

        <section className="landing-section" id="nosotros">
          <h2>{about.title}</h2>
          <div className="landing-about">
            {about.paragraphs.map((text) => <p key={text}>{text}</p>)}
          </div>
        </section>

        <section className="landing-section alt" id="servicios">
          <h2>{services.title}</h2>
          <div className="landing-cards">
            {services.items.map((item) => {
              const Icon = ICONS[item.icon];
              return (
                <article className="landing-card" key={item.title}>
                  <span className="landing-card-icon"><Icon size={22} /></span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="landing-section" id="valores">
          <h2>{values.title}</h2>
          <ul className="landing-values">
            {values.items.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-section contact" id="contacto">
          <h2>{contact.title}</h2>
          <p className="landing-contact-lead">{contact.lead}</p>
          {contactRows.length > 0 && (
            <ul className="landing-contact">
              {contactRows.map(({ icon: Icon, label, value, href }) => (
                <li key={label}>
                  <Icon size={18} />
                  <span className="landing-contact-label">{label}</span>
                  {href ? <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{value}</a> : <span>{value}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="landing-footer">
        <span>© {year} Cooperativa Quinta Generación</span>
        <Link href={SYSTEM_PATH} prefetch={false}>Acceso al personal</Link>
      </footer>
    </div>
  );
}
