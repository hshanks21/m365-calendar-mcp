import {
  microsoftMsalReason,
  safeMicrosoftReason,
} from "./m365-diagnostics.js";
import { parentPort, workerData } from "node:worker_threads";
import {
  createMicrosoftClient,
  microsoftNetwork,
  publicDeviceMessage,
  serializedOfflineCache,
} from "./m365-msal.js";
import { DELEGATED_SCOPES, verifyDelegatedResult } from "./m365-delegated.js";
let stage = "device_start";
let reason = "unclassified";
try {
  const pca = createMicrosoftClient(
    workerData,
    microsoftNetwork(workerData, fetch, (value) => {
      reason = value;
    }),
  );
  const result = await pca.acquireTokenByDeviceCode({
    scopes: [...DELEGATED_SCOPES],
    timeout: 900,
    deviceCodeCallback: (d) => {
      stage = "device_display";
      const [verificationUri, userCode] = publicDeviceMessage(d);
      parentPort!.postMessage({ kind: "device", verificationUri, userCode });
      stage = "token_exchange";
    },
  });
  stage = "identity_scopes";
  verifyDelegatedResult(workerData, result);
  stage = "cache_validation";
  parentPort!.postMessage({
    kind: "result",
    value: { result, cache: serializedOfflineCache(pca) },
  });
} catch (error) {
  reason = safeMicrosoftReason(
    reason === "unclassified" ? microsoftMsalReason(error) : reason,
  );
  parentPort?.postMessage({ kind: "error", stage, reason });
}
