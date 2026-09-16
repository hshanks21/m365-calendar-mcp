# Historical public-client Microsoft bootstrap

The retained device-code helper (`npm run m365:oauth -- --help`) is operator-only historical support, **not** a fallback for confidential credentials. Do not enable public-client flows or repeat consent to work around a confidential runtime error. Current runtime selection supports explicit app-only or delegated-confidential mode; see [M365_RUNTIME.md](M365_RUNTIME.md).

Actual authorization requires separate owner approval, reviewed dedicated identity and narrow scopes, pinned account compatibility, private temporary Doppler write custody and exact secure readback. No tokens/codes/cache values belong in chat, command arguments or files. The executable-checkout cwd/scope and fixed project/config remain intentional; source publication does not provision an identity for the new scope. Public account pins are reserved invalid examples. Independent review is required before adaptation or live use.
