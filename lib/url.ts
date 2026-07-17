const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^0\./,
  /^224\./,
  /^255\./,
];

function isPrivateIpv4(hostname: string) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => part > 255)) return true;
  if (PRIVATE_IPV4.some((pattern) => pattern.test(hostname))) return true;
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

export function normalizeAndValidateUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Enter a company website to analyze.");
  }

  const raw = input.trim();
  if (raw.length > 2048) throw new Error("That URL is too long.");

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("Enter a valid website URL, such as example.nl.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS websites can be analyzed.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs containing credentials are not supported.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const blockedHost =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.includes(":") ||
    isPrivateIpv4(hostname);

  if (blockedHost || (!hostname.includes(".") && !/^\[[a-f0-9:]+\]$/i.test(hostname))) {
    throw new Error("Private or local network addresses cannot be analyzed.");
  }

  parsed.hash = "";
  return parsed.toString();
}

export function normalizePageUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}
