import {NextRequest, NextResponse} from "next/server";

export const dynamic = "force-dynamic";
type Context = {params: Promise<{path: string[]}>};

async function proxy(request: NextRequest, context: Context) {
  const {path} = await context.params;
  const method = request.method;
  const collection = path.length === 1 && path[0] === "bookings";
  const item = path.length === 2 && path[0] === "bookings" && /^[\w-]+$/.test(path[1]);
  const allowed = (method === "GET" && path.length === 1 && path[0] === "slots") ||
    (collection && (method === "POST" || method === "GET")) ||
    (item && (method === "GET" || method === "DELETE"));
  if (!allowed) return NextResponse.json({error: "not found"}, {status: 404});
  if (method === "POST" || method === "DELETE") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== request.nextUrl.origin) {
      return NextResponse.json({error: "invalid origin"}, {status: 403});
    }
  }
  const base = process.env.CLINIC_API_URL;
  const key = process.env.CLINIC_API_KEY;
  if (!base || !key) return NextResponse.json({error: "booking service is not configured"}, {status: 503});
  const headers: Record<string, string> = {"X-API-Key": key, "Content-Type": "application/json"};
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  try {
    const body = method === "POST" ? await request.text() : undefined;
    if (body && new TextEncoder().encode(body).byteLength > 16384) {
      return NextResponse.json({error: "request too large"}, {status: 413});
    }
    const upstream = await fetch(`${base.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, {
      method, headers, body, cache: "no-store", signal: AbortSignal.timeout(20000), redirect: "error"
    });
    const outputHeaders: Record<string, string> = {"Cache-Control": "no-store"};
    const retry = upstream.headers.get("Retry-After");
    if (retry) outputHeaders["Retry-After"] = retry;
    return NextResponse.json(await upstream.json(), {status: upstream.status, headers: outputHeaders});
  } catch {
    return NextResponse.json({error: "The booking service is unavailable. Please retry shortly."}, {status: 503});
  }
}
export {proxy as GET, proxy as POST, proxy as DELETE};
