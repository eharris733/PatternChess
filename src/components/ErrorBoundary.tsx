import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] caught render error', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-text-primary p-6">
        <div className="card max-w-md w-full flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="label text-mistake">Something went wrong</span>
            <h1 className="heading-md">
              The page hit an unexpected error
            </h1>
          </div>
          <p className="text-sm text-text-secondary">
            We've logged it to the console. You can reload the page or head back to the
            dashboard.
          </p>
          <pre className="text-xs font-mono bg-surface-3 rounded-none border-2 border-[#1A1A1A] p-3 text-[#1A1A1A] overflow-auto max-h-40">
            {error.name}: {error.message}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className="btn-outline flex-1"
              onClick={() => {
                this.reset();
                window.location.assign('/');
              }}
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
