export const DEFAULT_API_PORT = 4310;
export const DEFAULT_CLIENT_PORT = 5173;

export function configuredPort(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const text = String(value).trim();
  const port = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer port between 1 and 65535.`);
  }
  return port;
}

export function runtimePorts(env = process.env) {
  const apiPort = configuredPort(env.PORT, DEFAULT_API_PORT, "PORT");
  const clientPort = configuredPort(env.CLIENT_PORT, DEFAULT_CLIENT_PORT, "CLIENT_PORT");
  if (apiPort === clientPort) {
    throw new Error("PORT and CLIENT_PORT must use different TCP ports for the API and browser server.");
  }
  return { apiPort, clientPort, apiUrl: `http://127.0.0.1:${apiPort}`, clientUrl: `http://127.0.0.1:${clientPort}/` };
}

export function serverListenError(error, port) {
  if (error?.code === "EADDRINUSE") {
    return `API TCP port ${port} is already in use. Close the other lab instance or set PORT to a free port before starting the app.`;
  }
  if (error?.code === "EACCES") {
    return `API TCP port ${port} cannot be opened. Set PORT to an available port above 1023 and restart the app.`;
  }
  return `The local API could not start on TCP port ${port}. Check the server logs and port configuration.`;
}
