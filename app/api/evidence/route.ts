import { z } from 'zod';

const requestSchema = z.object({ url: z.string().trim().url().max(2048) }).strict();

function isPrivateIpv4(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const octets = hostname.split('.').map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function validatePublicHttpUrl(input: string) {
  const parsed = new URL(input);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only public HTTP or HTTPS URLs can be investigated.');
  if (parsed.username || parsed.password) throw new Error('URLs containing credentials are not accepted.');
  if (parsed.port && !((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443'))) throw new Error('Only standard public web ports are accepted.');
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) throw new Error('Direct IP address targets are blocked.');
  const blockedName = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localtest.me') || hostname.endsWith('.nip.io') || hostname.endsWith('.sslip.io');
  const blockedIpv6 = hostname === '::1' || hostname === '::' || hostname.startsWith('::ffff:') || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe8') || hostname.startsWith('fe9') || hostname.startsWith('fea') || hostname.startsWith('feb');
  if (blockedName || blockedIpv6 || isPrivateIpv4(hostname)) throw new Error('Local, private, and link-local network targets are blocked.');
  return parsed.toString();
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown, limit: number) {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[\u202A-\u202E\u2066-\u2069]/g, '').trim();
  return clean ? clean.slice(0, limit) : undefined;
}

export async function POST(request: Request) {
  let requestedUrl: string;
  try {
    const input = requestSchema.parse(await request.json());
    requestedUrl = validatePublicHttpUrl(input.url);
  } catch (error) {
    const message = error instanceof Error && !(error instanceof z.ZodError) ? error.message : 'Submit one valid public website URL.';
    return json({ success: false, error: message }, 400);
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return json({ success: false, error: 'Live web evidence is not configured. The investigation can continue with pasted content.' }, 503);

  try {
    const endpoint = `${(process.env.FIRECRAWL_API_URL ?? 'https://api.firecrawl.dev').replace(/\/$/, '')}/v2/scrape`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: requestedUrl,
        formats: ['markdown', 'links'],
        onlyMainContent: true,
        removeBase64Images: true,
        blockAds: true,
        maxAge: 0,
        storeInCache: false,
        timeout: 20000,
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]),
    });

    const payload = asRecord(await response.json().catch(() => ({})));
    if (!response.ok || payload.success !== true) {
      return json({ success: false, error: 'The live source could not be retrieved safely. Analysis can continue with the submitted content.' }, 502);
    }

    const data = asRecord(payload.data ?? payload);
    const metadata = asRecord(data.metadata);
    const rawLinks = Array.isArray(data.links) ? data.links : [];
    const links = rawLinks
      .filter((value): value is string => typeof value === 'string')
      .map((value) => {
        try { return validatePublicHttpUrl(value.slice(0, 2048)); } catch { return ''; }
      })
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 25);
    const finalUrl = validatePublicHttpUrl(optionalString(metadata.url ?? metadata.sourceURL, 2048) ?? requestedUrl);

    const markdown = optionalString(data.markdown, 12000) ?? '';
    const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(markdown));
    const contentDigest = `sha256-${[...new Uint8Array(digestBytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;

    return json({
      success: true,
      provider: 'firecrawl',
      untrusted: true,
      trustInferred: false,
      requestedUrl,
      finalUrl,
      title: optionalString(metadata.title ?? data.title, 200),
      description: optionalString(metadata.description ?? data.description, 500),
      markdown,
      links,
      statusCode: typeof metadata.statusCode === 'number' ? metadata.statusCode : undefined,
      cacheState: optionalString(metadata.cacheState, 40),
      cachedAt: optionalString(metadata.cachedAt, 80),
      fetchedAt: new Date().toISOString(),
      contentDigest,
    });
  } catch {
    return json({ success: false, error: 'Live retrieval timed out or failed. Analysis can continue with pasted content.' }, 502);
  }
}
