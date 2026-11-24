import { useEffect, useState } from 'react';
import type { ThemeMode } from '../types/capture';

const STORAGE_KEY = 'kapture_otg_theme_mode';

function getSystemDark(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useThemeMode(initialMode?: ThemeMode) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    if (initialMode) return initialMode;
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'auto' || saved === 'dark' || saved === 'light') {
        return saved;
      }
    }
    return 'auto';
  });

  const [systemDark, setSystemDark] = useState<boolean>(getSystemDark);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: 'dark' | 'light' =
    themeMode === 'auto' ? (systemDark ? 'dark' : 'light') : themeMode;

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [resolvedTheme]);

  const setThemeMode = (next: ThemeMode) => {
    setThemeModeState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  };

  return {
    themeMode,
    resolvedTheme,
    setThemeMode,
  };
}
