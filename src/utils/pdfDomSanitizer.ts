/**
 * DOM & CSS Color Sanitizer for html2canvas / html2pdf.js
 *
 * Tailwind CSS v4 compiles color utilities and gradients using modern CSS Color 4/5
 * functions (`oklch(...)`, `oklab(...)`, `lab(...)`, `lch(...)`, `color-mix(...)`, `color(...)`).
 * `html2canvas` v1.4.1 (bundled inside `html2pdf.js`) throws:
 *   `Error: Attempting to parse an unsupported color function "oklch"`
 * whenever it encounters these functions in stylesheets or computed styles.
 *
 * This utility converts all modern CSS color functions into standard `rgb(...)` / `rgba(...)`
 * inside the cloned iframe document (`onclone`) and caps canvas scaling so tall DOM reports
 * never exceed browser maximum canvas dimensions.
 */

const UNSUPPORTED_COLOR_FN_REGEX = /\b(oklch|oklab|lab|lch|color-mix|color|light-dark)\s*\(/i;

const COLOR_STYLE_PROPERTIES = [
  'color',
  'backgroundColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'columnRuleColor',
  'caretColor',
  'fill',
  'stroke',
  'stopColor',
  'floodColor',
  'lightingColor'
] as const;

let sharedColorCtx: CanvasRenderingContext2D | null = null;
const colorConversionCache = new Map<string, string>();

function getColorCanvasContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!sharedColorCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    sharedColorCtx = canvas.getContext('2d', { willReadFrequently: true });
  }
  return sharedColorCtx;
}

/**
 * Resolves any browser-supported CSS color string (including `oklch(...)`, `oklab(...)`,
 * `color-mix(...)`, `color(srgb ...)`) into a standard `rgb(r, g, b)` or `rgba(r, g, b, a)`
 * string that `html2canvas` can parse natively.
 */
export function resolveCssColorToRgb(rawColor: string, fallback = 'rgb(15, 23, 42)'): string {
  const trimmed = rawColor.trim();
  if (!trimmed) return fallback;
  const cached = colorConversionCache.get(trimmed);
  if (cached) return cached;

  const ctx = getColorCanvasContext();
  if (!ctx) return fallback;

  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000000';
    ctx.fillStyle = trimmed;
    const normalized = ctx.fillStyle;
    // If browser normalized it to #rrggbb or rgba(...), return it directly if supported
    if (
      normalized &&
      !UNSUPPORTED_COLOR_FN_REGEX.test(normalized) &&
      (normalized.startsWith('#') || normalized.startsWith('rgb'))
    ) {
      colorConversionCache.set(trimmed, normalized);
      return normalized;
    }

    // Otherwise sample the 1x1 pixel directly from the canvas backing store
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    const alpha = +(data[3] / 255).toFixed(3);
    const result =
      alpha >= 0.999
        ? `rgb(${data[0]}, ${data[1]}, ${data[2]})`
        : `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${alpha})`;
    colorConversionCache.set(trimmed, result);
    return result;
  } catch {
    return fallback;
  }
}

/**
 * Replaces balanced functional color expressions (`oklch(...)`, `oklab(...)`, `color-mix(...)`, etc.)
 * inside arbitrary CSS text (such as `<style>` sheets, `box-shadow`, or `background-image` gradients).
 */
export function replaceUnsupportedColorFunctionsInCssText(cssText: string): string {
  if (!cssText || !UNSUPPORTED_COLOR_FN_REGEX.test(cssText)) {
    return cssText;
  }

  // Also strip `in oklab` / `in oklch` / `in srgb` gradient interpolation tokens that html2canvas cannot parse
  let cleaned = cssText.replace(/\bin\s+(oklab|oklch|srgb|srgb-linear|display-p3|hsl|hwb|lab|lch)\b\s*,?\s*/gi, '');

  const fnNames = ['color-mix', 'light-dark', 'oklch', 'oklab', 'lab', 'lch', 'color'];
  const pattern = new RegExp(`\\b(${fnNames.join('|')})\\s*\\(`, 'gi');

  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleaned)) !== null) {
    const startIdx = match.index;
    result += cleaned.slice(lastIndex, startIdx);

    // Find matching closing parenthesis considering nested parens
    let depth = 0;
    let i = pattern.lastIndex - 1; // points to '('
    for (; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          i++; // include closing ')'
          break;
        }
      }
    }

    const fullExpr = cleaned.slice(startIdx, i);
    const converted = resolveCssColorToRgb(fullExpr, 'rgb(100, 116, 139)');
    result += converted;

    lastIndex = i;
    pattern.lastIndex = i;
  }

  result += cleaned.slice(lastIndex);
  return result;
}

/**
 * Sanitizes a cloned `Document` inside `html2canvas`'s `onclone` callback so that no
 * `oklch` / `oklab` / `color-mix` functions remain in `<style>` tags or element styles.
 */
export function sanitizeClonedDomForHtml2Canvas(clonedDoc: Document, clonedRoot?: HTMLElement): void {
  try {
    // 1. Rewrite all <style> tags in the cloned document
    const styleEls = clonedDoc.querySelectorAll('style');
    styleEls.forEach((styleEl) => {
      if (styleEl.textContent && UNSUPPORTED_COLOR_FN_REGEX.test(styleEl.textContent)) {
        styleEl.textContent = replaceUnsupportedColorFunctionsInCssText(styleEl.textContent);
      }
    });

    const win = clonedDoc.defaultView || window;
    const rootNode = clonedRoot || clonedDoc.body;
    if (!rootNode) return;

    const elements: HTMLElement[] = [
      clonedDoc.documentElement,
      clonedDoc.body,
      rootNode,
      ...Array.from(rootNode.querySelectorAll<HTMLElement>('*'))
    ].filter(Boolean);

    for (const el of elements) {
      if (!el || !el.style) continue;

      // Sanitize inline style attribute if present
      const inlineStyle = el.getAttribute('style');
      if (inlineStyle && UNSUPPORTED_COLOR_FN_REGEX.test(inlineStyle)) {
        el.setAttribute('style', replaceUnsupportedColorFunctionsInCssText(inlineStyle));
      }

      const computed = win.getComputedStyle(el);
      if (!computed) continue;

      for (const prop of COLOR_STYLE_PROPERTIES) {
        const val = computed[prop as any];
        if (val && UNSUPPORTED_COLOR_FN_REGEX.test(val)) {
          (el.style as any)[prop] = resolveCssColorToRgb(val);
        }
      }

      // Check complex properties like boxShadow, backgroundImage, borderColor, textShadow
      const complexProps = ['boxShadow', 'textShadow', 'backgroundImage', 'borderColor'] as const;
      for (const cProp of complexProps) {
        const val = computed[cProp as any];
        if (val && UNSUPPORTED_COLOR_FN_REGEX.test(val)) {
          if (cProp === 'backgroundImage') {
            const replacedBg = replaceUnsupportedColorFunctionsInCssText(val);
            if (UNSUPPORTED_COLOR_FN_REGEX.test(replacedBg)) {
              el.style.backgroundImage = 'none';
            } else {
              el.style.backgroundImage = replacedBg;
            }
          } else {
            (el.style as any)[cProp] = replaceUnsupportedColorFunctionsInCssText(val);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Non-fatal warning during DOM color sanitization for PDF export:', err);
  }
}

/**
 * Computes a safe `html2canvas` scale factor so tall DOM containers never exceed
 * browser maximum canvas height/area limits (which otherwise cause empty JPEG errors).
 */
export function computeSafeHtml2CanvasScale(element: HTMLElement, preferredScale = 2): number {
  const height = Math.max(element.scrollHeight || 0, element.offsetHeight || 0, 800);
  const maxSafeCanvasHeight = 14000;
  if (height * preferredScale <= maxSafeCanvasHeight) {
    return preferredScale;
  }
  const scaled = maxSafeCanvasHeight / height;
  return Math.max(0.75, Math.min(preferredScale, Number(scaled.toFixed(2))));
}
