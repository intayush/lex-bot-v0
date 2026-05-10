import fs from 'fs';
import path from 'path';

interface ManifestFile {
  path: string;
  title: string;
  section_type: string;
  word_count: number;
  content_hash: string;
  keywords: string[];
}

export function generateManifest(outputDir: string, files: ManifestFile[], baseUrl: string, deterministic?: boolean): void {
  const manifest = {
    version: 1,
    generated_at: deterministic ? '2026-01-01T00:00:00.000Z' : new Date().toISOString(),
    base_url: baseUrl,
    files,
  };

  const manifestPath = path.join(outputDir, '_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}
