'use client';

import { useEffect, useState } from 'react';
import {
  THEME_CHANGE_EVENT,
  THEME_COOKIE_MAX_AGE_SEC,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  type Theme,
  isTheme,
} from '@/lib/theme';

type ThemeToggleProps = {
  initialTheme?: Theme;
  className?: string;
};

function getSystemTheme(): Theme {
  if (!window.matchMedia) {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function getStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);

    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function getDocumentTheme(): Theme | null {
  if (document.documentElement.classList.contains('dark')) {
    return 'dark';
  }

  if (document.documentElement.classList.contains('light')) {
    return 'light';
  }

  return null;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export default function ThemeToggle({
  initialTheme = 'light',
  className = '',
}: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextTheme = getDocumentTheme() ?? getStoredTheme() ?? getSystemTheme();

      setTheme(nextTheme);
      applyTheme(nextTheme);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  function handleToggle() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';

    setTheme(nextTheme);
    applyTheme(nextTheme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Theme switching should still work when storage is unavailable.
    }

    document.cookie = `${THEME_COOKIE_NAME}=${nextTheme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SEC}; SameSite=Lax`;
  }

  const ariaLabel = theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro';
  const ariaPressed = theme === 'dark';
  const icon =
    theme === 'dark' ? (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
        <path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" />
      </svg>
    ) : (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008" />
      </svg>
    );

  return (
    <button
      type="button"
      className={`ui-icon-button theme-toggle-button panel-theme-toggle ${className}`.trim()}
      onClick={handleToggle}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
