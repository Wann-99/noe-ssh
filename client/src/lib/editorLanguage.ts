export function languageLabelForPath(path: string): string {
  const filename = path.split('/').pop()?.toLowerCase() || '';
  const ext = filename.includes('.') ? filename.split('.').pop() || '' : '';

  if (ext === 'json' || ext === 'jsonc') return 'JSON';
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'JavaScript';
  if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) return 'TypeScript';
  if (ext === 'py' || filename === 'pythonfile') return 'Python';
  if (['md', 'mdx', 'markdown'].includes(ext)) return 'Markdown';
  if (['html', 'htm'].includes(ext)) return 'HTML';
  if (['css', 'scss', 'less'].includes(ext)) return 'CSS';
  if (['xml', 'svg', 'xsl'].includes(ext)) return 'XML';
  if (ext === 'sql') return 'SQL';
  if (['yaml', 'yml'].includes(ext)) return 'YAML';
  if (['sh', 'bash', 'zsh', 'fish'].includes(ext) || ['.bashrc', '.zshrc', '.profile'].includes(filename)) {
    return 'Shell';
  }
  return 'Plain Text';
}
