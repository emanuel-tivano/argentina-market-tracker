import type { Metadata } from 'next'
import Link from 'next/link'
import { ENV } from '@/lib/server/core/env'

const REPOSITORY_URL =
  'https://github.com/emanuel-tivano/argentina-market-tracker'
// Completar antes de publicar estos canales profesionales.
const LINKEDIN_URL: string | null = null
const CONTACT_EMAIL: string | null = null

export const metadata: Metadata = {
  title: 'Emanuel Tivano y el proyecto',
  description:
    'Presentación de Emanuel Tivano, autor de Argentina Market Tracker, y de las decisiones técnicas demostradas por el proyecto.',
}

const technicalDecisions = [
  {
    title: 'BFF interno',
    text: 'El browser consume Route Handlers de Next.js en lugar del proveedor externo. Esto mantiene credenciales y payloads crudos en el servidor, a cambio de operar una capa intermedia propia.',
  },
  {
    title: 'SSR con recuperación cliente',
    text: 'El dashboard y la cabecera de activos reciben datos iniciales desde el servidor; SWR continúa la revalidación. Mejora el primer render sin trasladar toda la interacción al servidor.',
  },
  {
    title: 'Caché resiliente',
    text: 'TTL fresh, fallback stale y deduplicación in-flight reducen trabajo repetido y sostienen datos conocidos ante fallos breves. En memoria, su alcance queda limitado a cada instancia.',
  },
  {
    title: 'Contratos antes que UI',
    text: 'Los datos externos se validan y normalizan antes de llegar a React. El costo es mantener adaptadores explícitos, pero los componentes reciben modelos predecibles y tipados.',
  },
  {
    title: 'Protección y observabilidad',
    text: 'Rate limiting, request IDs, métricas agregadas y logs sanitizados hacen visibles los fallos sin exponer secretos. El almacenamiento distribuido queda como configuración operativa opcional.',
  },
  {
    title: 'Pruebas por capas',
    text: 'Vitest cubre contratos, servicios, hooks, rutas y componentes; Playwright verifica SSR y flujos completos. La cobertura prioriza límites del sistema y estados degradados.',
  },
]

const stackGroups = [
  {
    title: 'Aplicación',
    text: 'Next.js 16, React 19, TypeScript 6 en modo strict y Tailwind CSS 4.',
  },
  {
    title: 'Datos e interfaz',
    text: 'App Router, Route Handlers, SWR y lightweight-charts para histórico.',
  },
  {
    title: 'Calidad',
    text: 'ESLint, contratos tipados, validadores y separación server/client.',
  },
  {
    title: 'Testing y operación',
    text: 'Vitest, Testing Library, Playwright, GitHub Actions, health checks y métricas.',
  },
]

const responsibilities = [
  'Diseñé la arquitectura App Router y la separación entre UI, contratos compartidos, BFF e integración server-only.',
  'Implementé el dashboard responsive, favoritos, detalle de activos, histórico, estados de carga/error/stale y temas claro y oscuro.',
  'Construí la integración demo/live, la autenticación upstream, la normalización de payloads y los contratos internos.',
  'Incorporé SSR inicial, cachés acotadas, deduplicación concurrente, rate limiting y degradación controlada.',
  'Definí la estrategia de tests, CI, observabilidad, seguridad de rutas debug y documentación operativa.',
]

const demonstratedCapabilities = [
  'Diseño de aplicaciones frontend y full-stack con límites de responsabilidad claros.',
  'Integración robusta con APIs externas y manejo explícito de fallos parciales.',
  'Modelado de contratos, validación de datos y evolución segura del BFF.',
  'Performance orientada al primer render, carga diferida y revalidación controlada.',
  'Calidad mediante tests automatizados, accesibilidad básica, observabilidad y documentación mantenible.',
]

export default function AboutPage() {
  const isDemoMode = ENV.MARKET_DATA_SOURCE === 'demo'
  const modeLabel = isDemoMode ? 'Modo demo activo' : 'Modo live activo'
  const hasAdditionalContact =
    LINKEDIN_URL !== null || CONTACT_EMAIL !== null

  return (
    <main className="about-page">
      <div className="about-shell">
        <header className="about-hero">
          <Link className="about-back-link" href="/">
            Volver al dashboard
          </Link>
          <p className="about-eyebrow">Autor y proyecto</p>
          <h1>Emanuel Tivano</h1>
          <p className="about-intro">
            Autor de <strong>Argentina Market Tracker</strong>, un dashboard de
            mercado argentino creado como pieza de portfolio full-stack.
          </p>
          <p className="about-intro">
            El proyecto demuestra diseño de arquitectura, integración segura
            con APIs, renderizado server-side, resiliencia operativa y una
            estrategia de calidad automatizada.
          </p>
          <div className="panel-actions about-actions">
            <a
              className="ui-button ui-button-primary about-repository-link"
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Explorar el código en GitHub
            </a>
            <a
              className="ui-button ui-button-secondary about-repository-link"
              href="#contacto"
            >
              Ver contacto
            </a>
          </div>
          <p className="about-mode-note">
            <strong>{modeLabel}.</strong>{' '}
            {isDemoMode
              ? 'El dashboard usa datos determinísticos de muestra, no cotizaciones en tiempo real.'
              : 'El dashboard obtiene datos del proveedor configurado mediante el BFF interno.'}
          </p>
        </header>

        <section className="about-section" aria-labelledby="problem-heading">
          <h2 id="problem-heading">Problema resuelto</h2>
          <p>
            El dashboard reúne paneles de acciones argentinas y CEDEARs,
            favoritos, cotización detallada e histórico en una experiencia
            consistente. Resuelve normalización de fuentes, estados parciales,
            actualización de datos y navegación responsive; no es una interfaz
            estática ni una conexión directa del navegador a una API externa.
          </p>
        </section>

        <section
          className="about-section"
          aria-labelledby="contribution-heading"
        >
          <h2 id="contribution-heading">Mi aporte y responsabilidades</h2>
          <p>
            Construí el proyecto de extremo a extremo, desde la arquitectura y
            la experiencia de usuario hasta la integración, las garantías
            operativas y la validación automatizada.
          </p>
          <ul className="about-list">
            {responsibilities.map((responsibility) => (
              <li key={responsibility}>{responsibility}</li>
            ))}
          </ul>
        </section>

        <section
          className="about-section"
          aria-labelledby="decisions-heading"
        >
          <h2 id="decisions-heading">Decisiones técnicas destacadas</h2>
          <div className="about-grid">
            {technicalDecisions.map((decision) => (
              <article key={decision.title} className="about-card">
                <h3>{decision.title}</h3>
                <p>{decision.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-section" aria-labelledby="stack-heading">
          <h2 id="stack-heading">Stack tecnológico</h2>
          <div className="about-grid">
            {stackGroups.map((group) => (
              <article key={group.title} className="about-card">
                <h3>{group.title}</h3>
                <p>{group.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="about-section"
          aria-labelledby="evidence-heading"
        >
          <h2 id="evidence-heading">Qué demuestra el proyecto</h2>
          <ul className="about-list">
            {demonstratedCapabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </section>

        <section className="about-section" aria-labelledby="scope-heading">
          <h2 id="scope-heading">Alcance y uso responsable</h2>
          <p>
            Es una demostración técnica, no un broker, una plataforma de
            trading ni asesoramiento financiero. El modo demo usa datos
            sintéticos; el modo live depende del proveedor configurado y las
            cachés en memoria son locales a cada instancia cuando no existe
            almacenamiento distribuido.
          </p>
        </section>

        <section
          id="contacto"
          className="about-section"
          aria-labelledby="contact-heading"
        >
          <h2 id="contact-heading">Contacto</h2>
          <p>
            El repositorio es el canal público disponible para revisar el
            proyecto y contactar al autor.
          </p>
          <ul className="about-list">
            <li>
              <strong>GitHub:</strong>{' '}
              <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Repositorio de Argentina Market Tracker
              </a>
            </li>
            {LINKEDIN_URL && (
              <li>
                <strong>LinkedIn:</strong>{' '}
                <a
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Perfil profesional de Emanuel Tivano
                </a>
              </li>
            )}
            {CONTACT_EMAIL && (
              <li>
                <strong>Correo profesional:</strong>{' '}
                <a href={`mailto:${CONTACT_EMAIL}`}>
                  {CONTACT_EMAIL}
                </a>
              </li>
            )}
          </ul>
          {!hasAdditionalContact && (
            <p className="about-mode-note">
              LinkedIn y correo profesional todavía no están publicados.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
