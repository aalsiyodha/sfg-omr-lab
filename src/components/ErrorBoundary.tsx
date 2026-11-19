import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorLogBox } from './ErrorLogBox';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="container py-4">
          <div className="card shadow-sm mx-auto" style={{ maxWidth: 800 }}>
            <div className="card-body p-4">
              <div className="d-flex align-items-center mb-3 text-danger">
                <i className="bi bi-exclamation-octagon fs-2 me-2" />
                <h4 className="fw-bold mb-0">Application Runtime Error</h4>
              </div>
              <p className="text-muted small mb-3">
                An error occurred during rendering. You can copy the diagnostic report below and paste it into the chat:
              </p>

              <ErrorLogBox
                title="Application Error Report"
                errorMessage={this.state.error?.message || 'Unknown render error'}
              />

              <div className="d-flex gap-2 mt-3">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    this.setState({ hasError: false, error: null });
                    window.location.reload();
                  }}
                >
                  <i className="bi bi-arrow-clockwise me-1" />Reload Application
                </button>
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => {
                    this.setState({ hasError: false, error: null });
                    window.location.href = '/';
                  }}
                >
                  <i className="bi bi-house me-1" />Go to Home
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
