<!--
════════════════════════════════════════════════════════════════════════════
ABOUT THIS DOCUMENT — DESIGN.md
Purpose : The UI/UX specification and design tokens. The single source of truth
          for how the product looks and feels — so implementation stays
          consistent and on-brand.
Audience: Anyone building UI (human or agent). Prevents ad-hoc, drifting styles.
Update  : When tokens, components, or interaction patterns change; when a new
          screen/flow is specified.
Belongs : Design tokens (color, spacing, type scale, radius, motion), component
          specs, layout/interaction patterns, accessibility rules, and any hard
          design rules ("do / don't").
NOT here: Component code, architecture. This is the spec the code implements.
Applies : Any project with a UI. Delete this file if there's no interface.
Delete this comment block once DESIGN holds real content.
════════════════════════════════════════════════════════════════════════════
-->

# DESIGN — <Project Name>

## Design tokens

```
--color-…      #……      /* semantic names, not raw hues */
--space-…      …px
--radius-…     …px
--font-…       …
--motion-…     …ms cubic-bezier(…)
```

## Components

| Component | Spec |
|-----------|------|
| <Button>  | <states, sizes, tokens used> |

## Interaction & layout patterns

<Navigation, spacing rhythm, responsive behavior, motion.>

## Accessibility

<Focus states, contrast, keyboard nav, reduced-motion.>

## Hard rules (do / don't)

- **Do:** <e.g. flat tokened surfaces, subtle borders>
- **Don't:** <e.g. no decorative AI gradients as default>
