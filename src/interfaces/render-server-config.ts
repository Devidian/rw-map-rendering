export interface RenderServerConfig {
  ip: string;
  port: number;
  baseUrl: string;
  name?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBackoffMs?: number;
}
