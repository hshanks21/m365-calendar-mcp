import { ClientSecretCredential } from "@azure/identity";
import { Graph } from "./graph.js";
import type { Config } from "./config.js";
export function createGraph(config: Config) {
  const credential = new ClientSecretCredential(
    config.tenantId,
    config.clientId,
    config.clientSecret,
    {
      authorityHost: "https://login.microsoftonline.com",
      retryOptions: { maxRetries: 0 },
    },
  );
  return new Graph({
    token: async (signal) => {
      const token = await credential.getToken(
        "https://graph.microsoft.com/.default",
        { abortSignal: signal },
      );
      if (!token?.token) throw Error("token_unavailable");
      return token.token;
    },
  });
}
