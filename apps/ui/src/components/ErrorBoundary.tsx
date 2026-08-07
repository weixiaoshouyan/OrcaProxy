/**
 * Enhanced ErrorBoundary with retry support and error detail display.
 *
 * Features:
 * - "Try Again" button that resets the error state without full reload.
 * - Collapsible error stack trace for debugging.
 * - Reports errors via a global event for logging.
 * - Preserves user data — never clears localStorage on error.
 */

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
  retryCount: number;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, errorInfo);
    this.setState({ errorInfo });

    // Dispatch global event for error logging
    window.dispatchEvent(
      new CustomEvent('orca:render-error', {
        detail: {
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          timestamp: Date.now(),
        },
      })
    );
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      retryCount: prev.retryCount + 1,
    }));
  };

  handleReload = () => {
    window.location.hash = '#/';
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, errorInfo, showDetails, retryCount } = this.state;

    return (
      <div
        style={{
          padding: 40,
          fontFamily: 'system-ui, sans-serif',
          color: 'var(--color-error)',
          background: 'var(--color-bg-base)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ maxWidth: 560, textAlign: 'center' }}>
          <h2
            style={{
              fontSize: 24,
              marginBottom: 8,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
            }}
          >
            Application Error
          </h2>
          <p
            style={{
              fontSize: 14,
              color: 'var(--color-text-secondary)',
              marginBottom: 20,
            }}
          >
            An unexpected error occurred. Your data is safe — you can try again
            or reload the application.
          </p>

          {/* Error message */}
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              textAlign: 'left',
              color: 'var(--color-text-secondary)',
              background: 'var(--color-bg-card)',
              padding: 16,
              borderRadius: 12,
              marginBottom: 16,
              maxHeight: 120,
              overflow: 'auto',
              border: '1px solid var(--color-border-base)',
            }}
          >
            {error?.message || 'Unknown error'}
          </pre>

          {/* Collapsible details */}
          <button
            onClick={() =>
              this.setState((prev) => ({ showDetails: !prev.showDetails }))
            }
            style={{
              padding: '6px 16px',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border-base)',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 12,
              marginBottom: 16,
            }}
          >
            {showDetails ? 'Hide details' : 'Show details'}
          </button>

          {showDetails && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 11,
                textAlign: 'left',
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-card)',
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
                maxHeight: 200,
                overflow: 'auto',
                border: '1px solid var(--color-border-base)',
              }}
            >
              {error?.stack || ''}
              {errorInfo?.componentStack || ''}
            </pre>
          )}

          {/* Action buttons */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
            }}
          >
            <button
              onClick={this.handleRetry}
              style={{
                padding: '10px 28px',
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Try Again{retryCount > 0 ? ` (${retryCount})` : ''}
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '10px 28px',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border-base)',
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      </div>
    );
  }
}
