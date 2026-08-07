/**
 * Last-line XSS defense — rehype plugin that removes dangerous HTML tags
 * and strips on* event attributes.
 *
 * Safety layers:
 *   1. rehype-raw: parse raw HTML into AST
 *   2. rehype-sanitize: standard sanitization pass
 *   3. THIS plugin — belt-and-suspenders on top
 */

interface HastElement {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

type HastNode = HastElement | { type: 'text'; value: string } | { type: 'root'; children?: HastNode[] };

const FORBIDDEN_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'applet', 'base', 'link',
  'meta', 'style', 'title', 'form', 'input', 'textarea', 'button',
  'select', 'option', 'frame', 'frameset', 'head', 'body', 'html',
  'marquee', 'blink', 'xml', 'xss',
]);

const DANGEROUS_ATTR_PREFIXES = ['on'];
const DANGEROUS_ATTRS = new Set(['style', 'formaction']);

function sanitizeAttributes(props: Record<string, unknown>): void {
  for (const key of Object.keys(props)) {
    // Strip on* event handlers
    if (DANGEROUS_ATTR_PREFIXES.some((p) => key.startsWith(p))) {
      delete props[key];
      continue;
    }
    // Strip style/formaction
    if (DANGEROUS_ATTRS.has(key)) {
      delete props[key];
      continue;
    }
    // Block javascript:/data:/vbscript: URLs
    if ((key === 'href' || key === 'src' || key === 'action') && typeof props[key] === 'string') {
      const val = (props[key] as string).trim().toLowerCase();
      if (
        val.startsWith('javascript:') ||
        val.startsWith('data:text/html') ||
        val.startsWith('vbscript:')
      ) {
        delete props[key];
      }
    }
  }
}

function walk(node: HastElement): boolean {
  // Returns true if the node should be removed
  if (node.tagName && FORBIDDEN_TAGS.has(node.tagName)) {
    return true;
  }

  // Sanitize attributes
  if (node.properties && typeof node.properties === 'object') {
    sanitizeAttributes(node.properties);
  }

  // Recursively walk children
  if (node.children && Array.isArray(node.children)) {
    const filtered: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === 'element' as string) {
        const shouldRemove = walk(child as HastElement);
        if (!shouldRemove) {
          filtered.push(child);
        }
      } else if (child.type === 'text' || child.type === 'root') {
        filtered.push(child);
      } else {
        // Preserve unknown node types (doctype, comment, etc.)
        filtered.push(child);
      }
    }
    node.children = filtered;
  }

  return false;
}

/**
 * Rehype plugin: walks the HAST tree to remove forbidden tags and
 * dangerous attributes that may have slipped past rehype-sanitize.
 */
export function rehypeSanitizeHardened(): (tree: HastNode) => HastNode {
  return (tree: HastNode): HastNode => {
    if ('children' in tree && Array.isArray(tree.children)) {
      tree.children = tree.children.filter((child: HastNode) => {
        if (child.type === 'element' as string) {
          return !(walk(child as HastElement) ?? false);
        }
        return true;
      }) as typeof tree.children;
    }
    return tree;
  };
}
