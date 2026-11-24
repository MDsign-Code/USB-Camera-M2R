import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Terjadi kesalahan tidak terduga pada studio perekaman.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Studio ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex items-center justify-center p-6 bg-zinc-50 dark:bg-[#090B0E] text-zinc-900 dark:text-zinc-100">
          <div className="max-w-md w-full p-6 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-4">
            <h1 className="text-lg font-semibold">Gangguan Sesi Studio</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2.5 text-sm font-medium rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors"
            >
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
