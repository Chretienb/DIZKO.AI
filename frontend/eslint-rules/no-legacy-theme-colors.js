/**
 * ESLint rule: no-legacy-theme-colors
 *
 * Theming (M1) routed every neutral background / text / hairline through CSS
 * variables (`var(--bg)`, `var(--surface)`, `C.t1`, `rgba(var(--fg),.06)`…) so
 * the whole app flips between light and dark by toggling one attribute.
 *
 * The single way to break light mode is to re-introduce one of the old
 * hard-coded neutral hexes. This rule denylists that exact palette so a
 * copy-pasted legacy value fails lint instead of shipping a dark patch.
 *
 * It deliberately does NOT ban all hex colors: white-on-accent (`#fff` on a
 * brand button), the brand purple, semantic accents (success/danger/warning)
 * and file-type chips are intentional and identical in both themes.
 *
 * It ALSO denylists the retired coral brand palette (2026-07 rebrand:
 * coral → purple) so the old brand can never leak back in via copy-paste.
 */

// Pre-tokenization neutral palette — these must never appear again.
const LEGACY_NEUTRALS = [
  // dark surfaces → now var(--bg) / var(--surface) / var(--surface-2) / var(--sidebar)
  '#0a0a0f', '#0c0c0f', '#0e0e10', '#0f0f12', '#101012', '#121214', '#141416',
  '#161618', '#18181b', '#1a1a1c', '#1c1c1e', '#202022', '#242426',
  // light surfaces that wouldn't flip back to dark → now var(--surface)/var(--surface-2)
  '#f9f9fa', '#f9f9f9', '#fafafa', '#f5f5f7', '#f0f0f4', '#f1f1f3',
  // gray text ramp → now var(--t1) / var(--t2) / var(--t3) (or C.t1/t2/t3)
  '#e3e3e8', '#a5a5ad', '#8a8a96',
  // retired coral brand (pre-2026-07 rebrand) → now C.brand / var(--brand)
  '#f4937a', '#e95a51', '#f28fb8', '#e8709a', '#f4a97c',
]

const SET = new Set(LEGACY_NEUTRALS.map(c => c.toLowerCase()))
// matches a 3/6-digit hex token inside any string
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g

const MESSAGE =
  "'{{color}}' is a legacy hard-coded neutral — use a theme token instead " +
  '(var(--bg|surface|surface-2|sidebar|border|t1|t2|t3) or rgba(var(--fg),α)) so light mode stays consistent.'

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow legacy hard-coded neutral colors; use theme tokens.' },
    schema: [],
    messages: { legacy: MESSAGE },
  },
  create(context) {
    function check(node, raw) {
      if (typeof raw !== 'string') return
      const matches = raw.toLowerCase().match(HEX)
      if (!matches) return
      for (const m of matches) {
        if (SET.has(m)) {
          context.report({ node, messageId: 'legacy', data: { color: m } })
          return
        }
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.raw)
      },
    }
  },
}
