# Roadmap — ordered follow-ups

1. Independently review the exact staged import, credential exclusions, sanitized identity pins and fresh-checkout evidence; commit/push the approved feature branch. Resolve the protected AGENTS documentation update with the owner. Root code licensing remains an owner decision; preserve font notices.
2. Plan a controlled deployment cutover only when separately authorized. Source checkout and installed sibling are intentionally distinct; do not move existing mounts or silently change secret-manager scope. Adapt reserved invalid identity pins with independent review before any new confidential deployment.
3. Repeat explicitly authorized live provider acceptance and scope denials for the intended installation. Synthetic tests and last-success telemetry are not continuous liveness or proof of credential-level isolation.
4. Release automation remains a design: only explicitly approved strict SemVer tags should trigger future build/promotion by immutable digest. No branch-push deployment, mutable latest, new workflow or tag is implemented here.

## Accepted v1 follow-ups

- Offset telemetry paging can drift or become empty; use regressions before adding snapshot/clamping behavior.
- Existing telemetry directories/adjacent temp paths remain trusted; separate ownership/symlink hardening and privilege-path review are needed for stronger custody.
- Complete keyboard/screen-reader/contrast audit before broad accessibility claims.
- Preserve numeric policy-slot semantics on reconfiguration; do not log real identity/calendar labels.
