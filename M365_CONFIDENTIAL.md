# Confidential Microsoft bootstrap (operator-only)

`npm run m365:oauth:code -- --help` prints credential-free help. Actual `--authorize` is a separately approved foreground operation, not part of build/test/deployment or an MCP tool. First review dedicated tenant/app/account/secret compatibility, exact account pin, narrow delegated scopes and private Doppler write/readback custody. Public source pins are deliberately invalid; see [M365_RUNTIME.md](M365_RUNTIME.md).

The helper uses official MSAL ConfidentialClientApplication, authorization code + S256 PKCE, random state/nonce/verifier and exact `http://localhost:8766/` redirect. Register the supported Web callback with the owner; preserve unrelated callbacks/app settings. Microsoft localhost port equivalence means different localhost ports are not automatically distinct registrations. Do not enable public-client or implicit flows as a workaround.

For a remote trusted browser, arrange an explicit loopback-only SSH tunnel for IPv4 and IPv6 localhost resolution, without exposing the callback on LAN. Verify both ports are unused. Sign in manually in the user's browser; no passwords, authorization codes, callback URLs or tokens in chat/logs. Callback acknowledgment is not success: require exact secure cache write **and internal readback** before claiming storage.

Only fixed Microsoft metadata/token endpoints, no redirects or endpoint environment overrides, bounded bodies/deadlines and sanitized stage/reason diagnostics. Cancellation closes the callback and aborts network work. The dedicated cache is written through private stdin only to the pinned Doppler key/scope; no file/argv cache export or generic secret fallback. Restore read-only runtime custody and revoke the temporary writer afterward under owner approval.

Bootstrap success does not approve a calendar or start the service. Discovery, exact calendar selection, runtime policy, independent review and live allowed/denied acceptance remain separate gates. See [M365_RUNTIME.md](M365_RUNTIME.md) and [SETUP.md](SETUP.md).
