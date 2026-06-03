type PublicSupabaseEnv = {
  url: string;
  publishableKey: string;
};

type ServerSupabaseEnv = {
  secretKey: string;
  ingestCredentialPepper: string;
};

export function getPublicSupabaseEnv(): PublicSupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return { url, publishableKey };
}

export function hasPublicSupabaseEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

export function hasServerSupabaseEnv() {
  return Boolean(hasPublicSupabaseEnv() && process.env.SUPABASE_SECRET_KEY);
}

export function hasIngestPersistenceEnv() {
  return Boolean(
    hasServerSupabaseEnv() && process.env.INGEST_CREDENTIAL_PEPPER,
  );
}

export function getServerSupabaseEnv(): ServerSupabaseEnv {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const ingestCredentialPepper = process.env.INGEST_CREDENTIAL_PEPPER;

  if (!secretKey || !ingestCredentialPepper) {
    throw new Error("Missing SUPABASE_SECRET_KEY or INGEST_CREDENTIAL_PEPPER");
  }

  return { secretKey, ingestCredentialPepper };
}

export function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

export function getDataProviderMode() {
  return process.env.TOKEN_PLANE_DATA_PROVIDER === "empty"
    ? "empty"
    : "supabase";
}
