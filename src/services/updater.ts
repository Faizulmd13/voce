import { getVersion } from '@tauri-apps/api/app';
import { openExternalUrl } from './tauri';

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseUrl: string;
  publishedAt?: string;
  releaseNotes?: string;
}

const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/Faizulmd13/voce/releases/latest';

export function compareSemver(remote: string, current: string): boolean {
  const cleanRemote = remote.replace(/^[^\d]*/, '').trim();
  const cleanCurrent = current.replace(/^[^\d]*/, '').trim();

  if (!cleanRemote || !cleanCurrent) return false;
  if (cleanRemote === cleanCurrent) return false;

  const rParts = cleanRemote.split('.').map((p) => parseInt(p, 10) || 0);
  const cParts = cleanCurrent.split('.').map((p) => parseInt(p, 10) || 0);

  const len = Math.max(rParts.length, cParts.length);
  for (let i = 0; i < len; i++) {
    const r = rParts[i] ?? 0;
    const c = cParts[i] ?? 0;
    if (r > c) return true;
    if (r < c) return false;
  }

  return false;
}

export async function getCurrentAppVersion(): Promise<string> {
  try {
    const v = await getVersion();
    if (v && v.trim()) return v.trim();
  } catch (err) {
    console.warn('Failed to retrieve version from Tauri API, falling back:', err);
  }
  return '0.1.0';
}

export async function checkForAppUpdate(): Promise<UpdateInfo> {
  const currentVersion = await getCurrentAppVersion();

  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API returned status ${res.status}`);
    }

    const data = await res.json();
    const tag = (data.tag_name || '').trim();
    const latestVersion = tag.replace(/^[^\d]*/, '') || tag;
    const hasUpdate = compareSemver(tag, currentVersion);

    return {
      hasUpdate,
      currentVersion,
      latestVersion: tag || latestVersion,
      releaseName: data.name || `Voce ${tag}`,
      releaseUrl: data.html_url || 'https://github.com/Faizulmd13/voce/releases',
      publishedAt: data.published_at,
      releaseNotes: data.body,
    };
  } catch (err) {
    console.warn('Update check failed:', err);
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseName: '',
      releaseUrl: 'https://github.com/Faizulmd13/voce/releases',
    };
  }
}

export async function openReleaseDownloadUrl(url: string): Promise<void> {
  try {
    await openExternalUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}
