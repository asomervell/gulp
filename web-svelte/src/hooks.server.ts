import type { Handle } from "@sveltejs/kit";

/**
 * IMPORTANT: Set BODY_SIZE_LIMIT environment variable to allow file uploads.
 * Default SvelteKit limit is 512KB. For file uploads, set:
 *   BODY_SIZE_LIMIT=52428800  (50MB)
 * or
 *   BODY_SIZE_LIMIT=0  (unlimited, then we handle it ourselves below)
 */

/**
 * Simple in-memory rate limiter
 * In production, consider using Redis or a distributed cache
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per IP
const RATE_LIMIT_MAX_API_REQUESTS = 10; // 10 API requests per minute per IP

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);

function getClientIP(request: Request): string {
  // Check common proxy headers
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }
  // Fallback
  return "unknown";
}

function checkRateLimit(
  ip: string,
  isApiRequest: boolean,
): { allowed: boolean; remaining: number; resetTime: number } {
  const key = `${ip}:${isApiRequest ? "api" : "general"}`;
  const now = Date.now();
  const maxRequests = isApiRequest
    ? RATE_LIMIT_MAX_API_REQUESTS
    : RATE_LIMIT_MAX_REQUESTS;

  let entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(key, entry);
  }

  entry.count++;

  return {
    allowed: entry.count <= maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    resetTime: entry.resetTime,
  };
}

/**
 * Security headers for all responses
 */
function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  // Prevent clickjacking
  headers.set("X-Frame-Options", "DENY");

  // Prevent MIME type sniffing
  headers.set("X-Content-Type-Options", "nosniff");

  // XSS protection (legacy browsers)
  headers.set("X-XSS-Protection", "1; mode=block");

  // Referrer policy
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy - restrict sensitive APIs
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );

  // Content Security Policy
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // SvelteKit needs inline scripts
      "style-src 'self' 'unsafe-inline'", // Tailwind needs inline styles
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Validate request size for API endpoints
 * Note: Also requires BODY_SIZE_LIMIT env var to be set >= this value
 */
const MAX_REQUEST_SIZE = 50 * 1024 * 1024; // 50MB for file uploads

export const handle: Handle = async ({ event, resolve }) => {
  const { request, url } = event;
  const ip = getClientIP(request);
  const isApiRequest = url.pathname.startsWith("/api/");

  // Check rate limit
  const rateLimit = checkRateLimit(ip, isApiRequest);

  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: "Too many requests",
        message: "Please slow down and try again later.",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(
            Math.ceil((rateLimit.resetTime - Date.now()) / 1000),
          ),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetTime / 1000)),
        },
      },
    );
  }

  // Check request size for API endpoints
  if (isApiRequest) {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
      return new Response(
        JSON.stringify({
          error: "Request too large",
          message: "File size exceeds the maximum allowed size of 50MB.",
        }),
        {
          status: 413,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // Block suspicious paths
  const suspiciousPaths = [
    "/.env",
    "/.git",
    "/wp-admin",
    "/wp-login",
    "/phpmyadmin",
    "/admin",
    "/.htaccess",
    "/config",
    "/backup",
  ];

  const lowerPath = url.pathname.toLowerCase();
  if (suspiciousPaths.some((p) => lowerPath.startsWith(p))) {
    return new Response("Not Found", { status: 404 });
  }

  // Process the request
  const response = await resolve(event);

  // Add security headers
  const securedResponse = addSecurityHeaders(response);

  // Add rate limit headers
  securedResponse.headers.set(
    "X-RateLimit-Remaining",
    String(rateLimit.remaining),
  );
  securedResponse.headers.set(
    "X-RateLimit-Reset",
    String(Math.ceil(rateLimit.resetTime / 1000)),
  );

  return securedResponse;
};
