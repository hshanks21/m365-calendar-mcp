---
version: alpha
name: Calendar Dispatch
description: Compact private calendar operations, charcoal surfaces and warm orange accents.
colors:
  primary: "#EDA66D"
  background: "#20211E"
  surface: "#262723"
  section: "#1B1C19"
  ink: "#EEECE3"
  muted: "#B0B0A4"
  line: "#44463D"
  sage: "#BDCA9B"
typography:
  h1:
    fontFamily: Cormorant Garamond
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.2
  h2:
    fontFamily: Cormorant Garamond
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.2
  body-md:
    fontFamily: Rubik
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: Rubik
    fontSize: 14px
    lineHeight: 1.5
  technical:
    fontFamily: Space Grotesk
    fontSize: 12px
  mast:
    fontFamily: Space Grotesk
    fontSize: 11px
rounded:
  control: 4px
  section: 8px
spacing:
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 48px
components:
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  section:
    backgroundColor: "{colors.section}"
    textColor: "{colors.ink}"
    rounded: "{rounded.section}"
    padding: 24px
  metrics:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.section}"
  muted-text:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted}"
  button:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  button-hover:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
  success:
    backgroundColor: "{colors.section}"
    textColor: "{colors.sage}"
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
---

## Overview

The imported UI is the current compact Calendar Dispatch, not the earlier oversized prose mockup. This document reconciles the existing design record with `public/app.css`, `index.html` and `app.js`; importing does not redesign or deploy those assets. Preserve charcoal/orange, meaningful named sections, clean semantic tables and honest measured state. No calendar contents or credential identities belong in the dashboard.

## Colors

`--bg` is #20211E, `--surface` #262723, ink #EEECE3, muted #B0B0A4, line #44463D, accent #EDA66D and sage #BDCA9B. Caller, under-hood and paper-trail sections use darker #1B1C19 with no outer border or shadow. Quiet internal table separators remain. Sage does not by itself prove provider readiness: text distinguishes configuration, unverified and historical complete-read success.

## Typography

Cormorant Garamond headings, Rubik body/controls, Space Grotesk technical labels/notices/logs. Central scale: title 36px, section 22px, body 16px, control 14px, utility 12px, mast 11px. Heading weight 600/line-height 1.2; body 400/1.5. No giant prose statistics, italic side commentary or decorative flourish. The retained Rubik italic asset remains licensed/provenanced, even though current CSS does not load it.

All fonts are local. Preserve `public/fonts/OFL.txt`, `Rubik-OFL.txt`, `SpaceGrotesk-OFL.txt` and `provenance.json` with pinned google/fonts commit and SHA-256 values. No browser CDN/font requests. `test/typography.test.ts` verifies assets/hashes/licenses and response headers.

## Layout

Masthead, main and footer are `min(1140px, calc(100% - 64px))`; the 700px breakpoint uses 32px outer allowance, stacked controls and compact sections. Spacing uses 8/16/24/32/48px tokens. Metrics use five equal columns at desktop. Repeated caller and activity records use semantic tables, not decorative tiles. Table wrappers contain horizontal overflow and remain keyboard focusable.

## Elevation & Depth

Flat tonal separation only. Darker named section cards have no shadows or colored perimeter borders. Overview/attention retain their subtle line border. Preserve useful table separators and visible focus outlines rather than removing all structure in the name of minimalism.

## Shapes

Controls have 4px radius, sections 8px; buttons/inputs have 44px minimum height. Focus is a 2px accent outline with 4px offset. Disabled controls use opacity 0.4. These source values are not a claim of full accessibility certification.

## Components

- Independent masked viewer login, explicit bad-key/rate-limit/unavailable feedback, logout and no localStorage credentials.
- Today/week/month selection with aria-pressed, offset reset, UTC/rolling window disclosure.
- Measured compact metrics with null no-data rates/latencies, not fabricated healthy zeros.
- Caller counts by numeric slots, never real identities; historical slot-order limitations remain explicit.
- Separate dashboard/MCP/Graph/Google health, protected access inspection and no admin mutations.
- Sanitized activity table, paging, manual/foreground polling refresh and clear empty/error/session-expired states. Offset pages are not stable snapshots.

Dynamic content uses text, not HTML injection. Source includes labels, native controls, live/alert regions and table semantics; a comprehensive keyboard/screen-reader/contrast audit remains separate. `tokens.json` is a documentation export, not runtime CSS; numeric line-height/components may be omitted by the CLI export, so source and this document remain authoritative.

## Do's and Don'ts

Keep the calendar SVG, compact READ-ONLY MCP/local labels, selected font roles and minimal named cards. Preserve local CSP-compatible assets and every font notice. Exercise desktop/mobile interactions and overflow before UI changes. Never bundle provider activation or deployment into visual work, invent usage figures, show meeting metadata, add giant decorative stats or claim a full accessibility audit from token lint.
