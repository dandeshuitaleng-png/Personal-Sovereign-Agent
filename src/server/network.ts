import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";
import * as cheerio from "cheerio";
export function publicAddress(address: string) {
  try {
    const ip = ipaddr.process(address);
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolvePublicUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Only public HTTP or HTTPS links without credentials are supported.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = ipaddr.isValid(hostname)
    ? [
        {
          address: hostname,
          family: ipaddr.parse(hostname).kind() === "ipv6" ? 6 : 4,
        },
      ]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error(
      "Private, local and reserved network addresses are not allowed as research links.",
    );
  return { url, addresses };
}
export async function readPublicPage(
  value: string,
  signal: AbortSignal,
  fetchPage: typeof fetch = fetch,
): Promise<{ text: string; finalUrl: string }> {
  let current = value;
  for (let redirects = 0; redirects <= 4; redirects++) {
    const { url, addresses } = await resolvePublicUrl(current);
    signal.throwIfAborted();
    // Pin the checked addresses to this connection; a second DNS answer cannot bypass the boundary.
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          const selected =
            addresses.find(
              (a) => !options.family || a.family === options.family,
            ) || addresses[0];
          if (options.all) callback(null, addresses as never);
          else callback(null, selected.address, selected.family);
        },
      },
    });
    try {
      const response = await fetchPage(url, {
        dispatcher,
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        headers: {
          "user-agent": "PersonalSovereignAgent/0.1",
          accept: "text/html,text/plain",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location)
          throw new Error("The page redirected without a destination.");
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`The page returned HTTP ${response.status}.`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("text/plain")
      ) {
        await response.body?.cancel();
        throw new Error(
          "This link is not a readable HTML or text page. Upload documents as files.",
        );
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body!) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024)
          throw new Error("The page exceeds the 5 MB limit.");
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let text = raw;
      if (contentType.includes("text/html")) {
        const $ = cheerio.load(raw);
        $("script,style,nav,footer,header,iframe,noscript").remove();
        text = $("main,article").first().text() || $("body").text();
      }
      text = text.replace(/\s+/g, " ").trim().slice(0, 250000);
      if (text.length < 40)
        throw new Error(
          "This page has no readable text. JavaScript-only pages are not supported.",
        );
      return { text, finalUrl: current };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error("The page redirected too many times.");
}
