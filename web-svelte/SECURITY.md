# Security Documentation

This document outlines the security measures implemented in the Gulp RSVP application.

## Overview

Gulp is a speed-reading web application that processes user-provided URLs and files. Security is critical as we handle external content and third-party API integrations.

## Security Measures

### 1. Rate Limiting

All requests are rate-limited to prevent abuse:

- **General requests**: 60 requests per minute per IP
- **API requests**: 15 requests per minute per IP

Rate limit headers are included in all responses:
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when the window resets

### 2. Input Validation

#### URL Validation (SSRF Protection)
- Only HTTP and HTTPS protocols are allowed
- Maximum URL length: 2048 characters
- Blocked hosts include:
  - `localhost`, `127.0.0.1`, `::1`
  - Private IP ranges (10.x, 172.16-31.x, 192.168.x)
  - Link-local addresses (169.254.x)
  - Cloud metadata endpoints (169.254.169.254, metadata.google)
  - Internal domains (.internal, .local)

#### File Upload Validation
- Maximum file size: 20MB
- Allowed file types (whitelist):
  - Documents: PDF, DOCX, TXT, MD, HTML, RTF, CSV, JSON, XML, YAML
  - Images: PNG, JPG, JPEG, GIF, WEBP
- Filename sanitization to prevent path traversal
- MIME type validation

### 3. Security Headers

All responses include the following security headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-XSS-Protection` | `1; mode=block` | XSS filter (legacy browsers) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer information |
| `Permissions-Policy` | Restrictive | Disable unnecessary browser features |
| `Content-Security-Policy` | Strict policy | Prevent XSS and injection attacks |

### 4. CSRF Protection

SvelteKit's built-in CSRF protection is enabled:
- Origin checking is enforced on all mutating requests
- Requests from different origins are rejected

### 5. API Security

- All API keys are stored as environment variables (never exposed to client)
- Private environment variables use `$env/static/private`
- Only `PUBLIC_` prefixed variables are exposed to the client

### 6. Request Size Limits

- Maximum request body size: 50MB
- Content-Length header is validated before processing

### 7. Suspicious Path Blocking

Common attack paths are blocked and return 404:
- `/.env`, `/.git`
- `/wp-admin`, `/wp-login`
- `/phpmyadmin`, `/admin`
- `/.htaccess`, `/config`, `/backup`

## Environment Variables

Required environment variables (never commit these):

```
GROQ_API_KEY=your_groq_api_key
OPENAI_API_KEY=your_openai_api_key
FIRECRAWL_API_KEY=your_firecrawl_api_key
```

## Deployment Recommendations

### Production Checklist

- [ ] Use HTTPS only (configure reverse proxy/load balancer)
- [ ] Set secure cookie attributes if using sessions
- [ ] Enable HSTS header at the reverse proxy level
- [ ] Use a Web Application Firewall (WAF) if available
- [ ] Monitor rate limit hits for potential attacks
- [ ] Set up logging and alerting for security events
- [ ] Regularly update dependencies (`npm audit`)

### Recommended Infrastructure

1. **Reverse Proxy** (nginx, Cloudflare, etc.)
   - SSL/TLS termination
   - Additional rate limiting
   - DDoS protection

2. **Environment**
   - Use environment variable management (not .env files in production)
   - Restrict network access to internal services

3. **Monitoring**
   - Log all API requests
   - Alert on rate limit violations
   - Monitor for unusual patterns

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly by contacting the maintainers directly. Do not open a public issue.

## Dependencies

Regularly audit dependencies for vulnerabilities:

```bash
npm audit
```

Update vulnerable packages when fixes are available:

```bash
npm audit fix
```
