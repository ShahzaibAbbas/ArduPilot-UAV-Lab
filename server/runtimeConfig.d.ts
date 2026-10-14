export const DEFAULT_API_PORT: number;
export const DEFAULT_CLIENT_PORT: number;
export function configuredPort(value: string | number | undefined, fallback: number, name: string): number;
export function runtimePorts(env?: Record<string, string | undefined>): {
  apiPort: number;
  clientPort: number;
  apiUrl: string;
  clientUrl: string;
};
export function serverListenError(error: { code?: string }, port: number): string;
