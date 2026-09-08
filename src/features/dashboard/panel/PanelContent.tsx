import { type ReactNode, useId } from 'react';
import Link from 'next/link';

import { type MarketPanelKey } from '@/lib/market';
import { type Theme } from '@/lib/theme';
import ThemeToggle from './ThemeToggle';

import PanelMenu from './PanelMenu';
import BackToTopButton from './BackToTopButton';
import { MARKET_PANEL_OPTIONS } from '@/features/dashboard/panel/marketPanelOptions';

type PanelContentProps = {
  title: string;
  activePanelKey: MarketPanelKey;
  initialTheme?: Theme;
  isDemoMode?: boolean;
  onChange: (key: MarketPanelKey) => void;
  status?: ReactNode;
  children: ReactNode;
};

export default function PanelContent({
  title,
  activePanelKey,
  initialTheme,
  isDemoMode = false,
  onChange,
  status,
  children,
}: PanelContentProps) {
  const titleId = useId();

  return (
    <section className="dashboard-container py-4" aria-labelledby={titleId}>
      <h1 id={titleId} className="page-title">{title}</h1>

      <div className="panel-toolbar">
        <div className="panel-menu-status">
          <PanelMenu
            activePanelKey={activePanelKey}
            onChange={onChange}
            options={MARKET_PANEL_OPTIONS}
          />

          <div className="panel-status">
            {isDemoMode && (
              <span
                className="ui-pill ui-pill-warning panel-demo-badge"
                aria-label="Demo pública con datos sintéticos"
                title="El deploy público usa datos sintéticos determinísticos para estabilidad y seguridad."
              >
                Demo público · datos sintéticos
              </span>
            )}
            {status}
          </div>
        </div>

      </div>

      <div className="stock-table-container">{children}</div>

      <footer className="dashboard-project-footer">
        <p>Información sobre los datos y las decisiones técnicas del proyecto.</p>
        <Link
          className="ui-button ui-button-secondary dashboard-project-link"
          href="/about"
        >
          Datos y proyecto
        </Link>
      </footer>

      <div
        className="dashboard-floating-actions"
        role="group"
        aria-label="Acciones rápidas"
      >
        <BackToTopButton />
        <ThemeToggle
          initialTheme={initialTheme}
          className="dashboard-floating-button"
        />
      </div>
    </section>
  );
}
