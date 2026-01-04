export function getAuthorizationHeader(username?: string, token?: string): string | undefined {
  if (!username || !token) {
    return undefined;
  }
  const encoded = Buffer.from(`${username}:${token}`).toString("base64");
  return `Basic ${encoded}`;
}
