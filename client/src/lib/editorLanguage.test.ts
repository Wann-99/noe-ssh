import { describe, expect, it } from 'vitest';
import { languageLabelForPath } from './editorLanguage';

describe('languageLabelForPath', () => {
  it.each([
    ['/etc/noe/config.json', 'JSON'],
    ['/srv/app/main.py', 'Python'],
    ['/srv/app/README.md', 'Markdown'],
    ['/srv/app/view.tsx', 'TypeScript'],
    ['/srv/app/deploy.sh', 'Shell'],
    ['/srv/app/docker-compose.yml', 'YAML'],
    ['/srv/app/query.sql', 'SQL'],
    ['/srv/app/unknown.data', 'Plain Text'],
  ])('detects %s as %s', (path, expected) => {
    expect(languageLabelForPath(path)).toBe(expected);
  });
});
