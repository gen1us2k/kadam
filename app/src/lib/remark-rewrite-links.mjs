// Rewrites repo-relative markdown links to web routes at build time.
// Keeps the root .md files canonical (readable on GitHub) while the site links work.
function mapLink(url) {
  if (!url) return url;
  if (/^(https?:)?\/\//.test(url) || url.startsWith('#') || url.startsWith('mailto:')) return url;

  const u = url.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');

  let m = u.match(/(?:^|weeks\/)(week-\d+)\/README\.md$/);
  if (m) return `/weeks/${m[1]}`;
  if (/grammar-cheatsheet\.md$/.test(u)) return '/grammar';
  if (/phrases\.md$/.test(u)) return '/phrases';
  if (/kyrgyz-frequency\.csv$/.test(u)) return '/vocab';
  if (/^anki(\/(README\.md)?)?$/.test(u)) return '/vocab';
  if (/^weeks\/?$/.test(u)) return '/';
  if (/^README\.md$/.test(u)) return '/';
  return url;
}

function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'link' && typeof node.url === 'string') fn(node);
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, fn);
}

export default function remarkRewriteLinks() {
  return (tree) => walk(tree, (node) => { node.url = mapLink(node.url); });
}
