import type { LogEntry, LogLevel, ProcessingStage } from '../types';

class DiagnosticLogger {
  private entries: LogEntry[] = [];

  private add(level: LogLevel, stage: ProcessingStage, message: string, data?: Record<string, unknown>) {
    this.entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      timestamp: new Date().toISOString(),
      stage,
      level,
      message,
      data,
    });
  }

  debug(stage: ProcessingStage, msg: string, data?: Record<string, unknown>) { this.add('DEBUG', stage, msg, data); }
  info(stage: ProcessingStage, msg: string, data?: Record<string, unknown>) { this.add('INFO', stage, msg, data); }
  warning(stage: ProcessingStage, msg: string, data?: Record<string, unknown>) { this.add('WARNING', stage, msg, data); }
  error(stage: ProcessingStage, msg: string, data?: Record<string, unknown>) { this.add('ERROR', stage, msg, data); }

  getAll(): LogEntry[] { return [...this.entries]; }
  getByLevel(level: LogLevel): LogEntry[] { return this.entries.filter(e => e.level === level); }
  clear(): void { this.entries = []; }

  exportTxt(): string {
    return this.entries.map(e =>
      `[${e.timestamp}] [${e.level}] [${e.stage}] ${e.message}${e.data ? ' | ' + JSON.stringify(e.data) : ''}`
    ).join('\n');
  }

  exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}

export const logger = new DiagnosticLogger();
