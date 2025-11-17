/**
 * Validates URLs to prevent SSRF (Server-Side Request Forgery) attacks
 * Only allows safe, external HTTP/HTTPS URLs
 * Note: DNS resolution is disabled to avoid Node.js runtime requirements
 */
export async function validateSafeUrl(
  urlString: string,
): Promise<{ isValid: boolean; error?: string }> {
  try {
    const url = new URL(urlString);

    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return {
        isValid: false,
        error: 'Only HTTP and HTTPS URLs are allowed',
      };
    }

    const hostname = url.hostname.toLowerCase();

    // BLOCK ALL LITERAL IP ADDRESSES (IPv4, IPv6, decimal)
    // This prevents SSRF attacks via direct IP access

    // Pure JavaScript IPv4 detection (dot-decimal notation)
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const [_, a, b, c] = ipv4Match.map(Number);

      // Check for private IPv4 ranges (RFC 1918)
      if (
        a === 10 || // 10.0.0.0/8
        (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
        (a === 192 && b === 168) || // 192.168.0.0/16
        (a === 169 && b === 254) || // 169.254.0.0/16 (link-local)
        a === 127 || // 127.0.0.0/8 (loopback)
        (a === 0 && b === 0 && c === 0 && ipv4Match[4] === '0') // 0.0.0.0
      ) {
        return {
          isValid: false,
          error: 'IP addresses are not allowed',
        };
      }

      // Block any IPv4 address (public or private)
      return {
        isValid: false,
        error: 'IP addresses are not allowed',
      };
    }

    // Pure JavaScript IPv6 detection (colon notation without brackets)
    if (hostname.includes(':') && hostname.match(/^[0-9a-f:.]+$/i)) {
      // Check for IPv6 private/link-local/loopback ranges
      const normalizedIP = hostname.toLowerCase();
      if (
        normalizedIP === '::1' || // IPv6 loopback
        normalizedIP.startsWith('fc') || // IPv6 private (fc00::/7)
        normalizedIP.startsWith('fd') || // IPv6 private (fd00::/8)
        normalizedIP.startsWith('fe80:') || // IPv6 link-local
        normalizedIP.startsWith('fec0:') || // IPv6 site-local (deprecated)
        normalizedIP === '::' // IPv6 unspecified
      ) {
        return {
          isValid: false,
          error: 'IP addresses are not allowed',
        };
      }

      // Block any IPv6 address
      return {
        isValid: false,
        error: 'IP addresses are not allowed',
      };
    }

    // Decimal IPv4: Check for dotless decimal (3232235777 = 192.168.1.1)
    const decimalMatch = hostname.match(/^\d+$/);
    if (decimalMatch) {
      return {
        isValid: false,
        error: 'IP addresses are not allowed',
      };
    }

    // Block localhost and common internal hostnames
    const blockedHosts = [
      'localhost',
      'broadcasthost',
      'local',
      'internal',
      'private',
      // Common internal TLDs
      'local',
      'internal',
      'private',
      'corp',
      'company',
      'lan',
      // Docker/Kubernetes internal
      'kubernetes.default.svc',
    ];

    if (blockedHosts.includes(hostname)) {
      return {
        isValid: false,
        error: 'Internal hostnames are not allowed',
      };
    }

    // Block custom ports (non-standard ports)
    // Standard ports are 80 (HTTP), 443 (HTTPS)
    const port = url.port;
    if (port && !['80', '443', ''].includes(port)) {
      return {
        isValid: false,
        error: 'Custom ports are not allowed',
      };
    }

    return { isValid: true };
  } catch (_error) {
    return {
      isValid: false,
      error: 'Invalid URL format',
    };
  }
}
