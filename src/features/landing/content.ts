/**
 * Texto de la página pública (portada). Todo lo que ve el público se edita aquí.
 * BORRADOR: revisa y ajusta cada texto con la información real de la cooperativa.
 * Los datos de contacto vacíos ("") no se muestran en la página.
 */
export const LANDING = {
  hero: {
    eyebrow: "Sociedad cooperativa",
    title: "Cooperativa Quinta Generación",
    lead:
      "Trabajo organizado, seguro y responsable. Una cooperativa formada por su gente, comprometida con la calidad de cada servicio y con el cuidado del entorno.",
  },

  about: {
    title: "Quiénes somos",
    paragraphs: [
      "Somos una sociedad cooperativa: nuestros socios son quienes trabajan en ella y quienes deciden su rumbo. Ese modelo nos une en una misma meta, hacer bien el trabajo y crecer juntos.",
      "Operamos con personal capacitado, procesos documentados y controles de seguridad en cada área, para dar a nuestros clientes un servicio confiable día con día.",
    ],
  },

  services: {
    title: "Lo que hacemos",
    items: [
      {
        icon: "users",
        title: "Personal operativo",
        text: "Cuadrillas organizadas por área y puesto, con supervisión y seguimiento de cada colaborador.",
      },
      {
        icon: "flame",
        title: "Combustibles alternos",
        text: "Recepción, pesaje y control de combustibles alternos para la sustitución térmica, dentro de los límites autorizados.",
      },
      {
        icon: "shield",
        title: "Seguridad e higiene",
        text: "Equipo de protección personal para cada trabajador y control de su entrega y reposición.",
      },
      {
        icon: "leaf",
        title: "Cuidado ambiental",
        text: "Registro y seguimiento de lo que recibimos y procesamos, para cumplir con la normatividad ambiental.",
      },
    ],
  },

  values: {
    title: "Nuestros valores",
    items: [
      { title: "Trabajo en equipo", text: "Cada socio aporta y cada socio cuenta." },
      { title: "Seguridad primero", text: "Nadie trabaja sin el equipo y la capacitación adecuados." },
      { title: "Responsabilidad", text: "Cumplimos lo que acordamos, en tiempo y forma." },
      { title: "Transparencia", text: "Registros claros y procesos que se pueden revisar." },
    ],
  },

  contact: {
    title: "Contacto" as string,
    lead: "¿Quieres trabajar con nosotros o conocer nuestros servicios? Escríbenos.",
    // Llénalos con los datos reales; si se quedan vacíos, no aparecen.
    address: "" as string,
    phone: "" as string,
    email: "" as string,
    hours: "" as string,
    // Enlace de Google Maps (opcional), por ejemplo https://maps.app.goo.gl/...
    mapsUrl: "" as string,
  },
} as const;
