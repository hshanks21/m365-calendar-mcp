import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { isIP } from "node:net";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { createSecureContext } from "node:tls";
export type DashboardTransport = {
  bindAddress?: string;
  certFile?: string;
  keyFile?: string;
};

// No wildcard, DNS resolution, public address, proxy origin or HTTP LAN mode.
export function validateDashboardTransport(input: DashboardTransport = {}) {
  try {
    const bindAddress = input.bindAddress ?? "127.0.0.1";
    const parts = bindAddress.split(".").map(Number);
    const privateIP =
      isIP(bindAddress) === 4 &&
      (parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168));
    if (bindAddress !== "127.0.0.1" && !privateIP) throw Error();
    if (input.certFile === undefined && input.keyFile === undefined) {
      if (bindAddress !== "127.0.0.1") throw Error();
      return { bindAddress, tls: undefined };
    }
    const read = (path: string | undefined, privateKey: boolean) => {
      if (!path || !isAbsolute(path)) throw Error();
      const st = lstatSync(path);
      if (
        !st.isFile() ||
        st.size > 65536 ||
        st.size === 0 ||
        (privateKey && (st.mode & 0o077) !== 0)
      )
        throw Error();
      return readFileSync(path);
    };
    const cert = read(input.certFile, false),
      key = read(input.keyFile, true);
    const certificate = new X509Certificate(cert);
    const now = Date.now();
    if (
      !certificate.checkIP(bindAddress) ||
      !(
        Date.parse(certificate.validFrom) <= now &&
        now < Date.parse(certificate.validTo)
      ) ||
      !certificate.checkPrivateKey(createPrivateKey(key))
    )
      throw Error();
    const tls = { cert, key, minVersion: "TLSv1.2" as const };
    createSecureContext(tls); // Parse the full chain/key before any listen call.
    return { bindAddress, tls };
  } catch {
    // Avoid leaking filesystem paths, certificate contents or OpenSSL details.
    throw Error(
      "Invalid dashboard transport; explicit private IPv4 and valid TLS cert/key required for LAN",
    );
  }
}
