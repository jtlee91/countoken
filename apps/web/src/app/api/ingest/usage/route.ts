import { NextResponse } from "next/server";

import {
  hasUsableIngestCredential,
  readIngestCredential,
} from "@/lib/ingest/credentials";
import { verifyDeviceCredential } from "@/lib/ingest/device-credentials";
import { persistUsageEvent } from "@/lib/ingest/persistence";
import { validateUsagePayload } from "@/lib/privacy/usage-payload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const credential = readIngestCredential(request.headers);

  if (!credential || !hasUsableIngestCredential(credential)) {
    return NextResponse.json(
      {
        error_type: "unauthorized",
        safe_message: "Missing or invalid ingest credential.",
      },
      { status: 401 },
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        error_type: "invalid_json",
        safe_message: "Expected a JSON object usage payload.",
      },
      { status: 400 },
    );
  }

  const validation = validateUsagePayload(payload);

  if (!validation.ok) {
    return NextResponse.json(
      {
        error_type: validation.errorType,
        safe_message: validation.safeMessage,
      },
      { status: 400 },
    );
  }

  const verification = await verifyDeviceCredential(
    validation.event,
    credential,
  );

  if (!verification.ok) {
    return NextResponse.json(
      {
        error_type: verification.errorType,
        safe_message: verification.safeMessage,
      },
      { status: verification.status },
    );
  }

  const persistence = await persistUsageEvent(
    validation.event,
    verification.context,
  );

  if (!persistence.ok) {
    return NextResponse.json(
      {
        error_type: persistence.errorType,
        safe_message: persistence.safeMessage,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      status: persistence.duplicate ? "duplicate" : "accepted",
      persisted: persistence.persisted,
      duplicate: persistence.duplicate,
      event_fingerprint: validation.event.event_fingerprint,
    },
    {
      status: persistence.duplicate
        ? 200
        : persistence.persisted
          ? 201
          : 202,
    },
  );
}
