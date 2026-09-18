const TEXT_METRIC_PROPERTIES = [
  "direction",
  "font-family",
  "font-feature-settings",
  "font-kerning",
  "font-optical-sizing",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-synthesis",
  "font-variant",
  "font-variation-settings",
  "font-weight",
  "hyphens",
  "letter-spacing",
  "line-break",
  "line-height",
  "overflow-wrap",
  "tab-size",
  "text-orientation",
  "text-rendering",
  "text-transform",
  "white-space",
  "word-break",
  "word-spacing",
  "writing-mode",
] as const;

/** Match a layout-only suffix to the consumer's actual rendered inline code. */
export const synchronizeInlineCodeReservations = (root: HTMLElement): void => {
  const view = root.ownerDocument.defaultView;
  if (!view) return;

  for (const reserve of root.querySelectorAll<HTMLElement>(
    "[data-smoothstream-code-reserve]",
  )) {
    const code = reserve.previousElementSibling;
    if (code?.localName !== "code") continue;
    const computed = view.getComputedStyle(code);
    for (const property of TEXT_METRIC_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value && reserve.style.getPropertyValue(property) !== value) {
        reserve.style.setProperty(property, value);
      } else if (!value && reserve.style.getPropertyValue(property)) {
        reserve.style.removeProperty(property);
      }
    }
  }
};
