import { AppConfig } from './app-config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const order: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

class Logger {
  debug(...args: unknown[]): void {
    this.write('debug', args);
  }

  info(...args: unknown[]): void {
    this.write('info', args);
  }

  warn(...args: unknown[]): void {
    this.write('warn', args);
  }

  error(...args: unknown[]): void {
    this.write('error', args);
  }

  private write(level: LogLevel, args: unknown[]): void {
    if (AppConfig.logLevel === 'off') return;
    if (order[level] < order[AppConfig.logLevel]) return;
    console[level](...args);
  }
}

export const defaultLogger = new Logger();
