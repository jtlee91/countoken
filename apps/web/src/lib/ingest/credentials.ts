export function readIngestCredential(headers: Headers) {
  const explicit = headers.get("x-token-plane-ingest-key");

  if (explicit) {
    return explicit;
  }

  const authorization = headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length);
}

export function hasUsableIngestCredential(credential: string | null) {
  return Boolean(credential && credential.trim().length >= 24);
}
