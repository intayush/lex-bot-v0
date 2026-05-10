export function urlToFilename(pageUrl: string, rootUrl: string): string {
  let pathname: string;

  try {
    const url = new URL(pageUrl);
    const root = new URL(rootUrl);

    if (url.protocol === 'file:') {
      // Make path relative to the root directory
      const rootDir = root.pathname.endsWith('/')
        ? root.pathname
        : root.pathname.replace(/\/[^/]*$/, '/');
      pathname = url.pathname.startsWith(rootDir)
        ? url.pathname.slice(rootDir.length)
        : url.pathname.split('/').slice(-2).join('/');
    } else {
      pathname = url.pathname;
    }
  } catch {
    pathname = pageUrl.replace(/^file:\/\//, '');
    const lastSlash = pathname.lastIndexOf('/');
    pathname = pathname.slice(lastSlash);
  }

  // Remove leading/trailing slashes
  pathname = pathname.replace(/^\/+|\/+$/g, '');

  // Handle root/index
  if (!pathname || pathname === '') {
    return 'index.md';
  }

  // Remove .html extension
  pathname = pathname.replace(/\.html?$/, '');

  // Replace path separators with double dashes
  const filename = pathname.replace(/\//g, '--');

  // Clean up characters
  const clean = filename
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return `${clean || 'index'}.md`;
}
