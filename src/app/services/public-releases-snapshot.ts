import { makeStateKey } from '@angular/core';
import type { ChangelogPost } from './app.whats-new.service';

export type PublicReleasePost = Omit<ChangelogPost, 'date' | 'published'> & { date: string; published: true };
export interface PublicReleasesSnapshot {
  version: 1;
  generatedAt: string;
  posts: PublicReleasePost[];
}

export const PUBLIC_RELEASES_SNAPSHOT_FILE_PATH = 'tmp/public-releases-snapshot.json';
export const PUBLIC_RELEASES_TRANSFER_STATE_KEY = makeStateKey<PublicReleasePost[]>('quantified-self.public-releases.v1');
const POST_FIELDS = new Set(['id', 'title', 'description', 'date', 'published', 'type', 'image', 'version']);

export function parsePublicReleasesSnapshot(value: unknown): PublicReleasesSnapshot {
  if (!isRecord(value) || value.version !== 1
    || typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))
    || !Array.isArray(value.posts) || !value.posts.every(isPublicReleasePost)
    || new Set(value.posts.map(post => post.id)).size !== value.posts.length) {
    throw new Error('Public release notes snapshot has an invalid shape.');
  }
  return value as unknown as PublicReleasesSnapshot;
}

function isPublicReleasePost(value: unknown): value is PublicReleasePost {
  return isRecord(value) && Object.keys(value).every(key => POST_FIELDS.has(key))
    && typeof value.id === 'string' && !!value.id && !value.id.includes('/')
    && typeof value.title === 'string' && !!value.title.trim()
    && typeof value.description === 'string' && !!value.description.trim()
    && typeof value.date === 'string' && !Number.isNaN(Date.parse(value.date))
    && value.published === true
    && ['major', 'minor', 'patch', 'announcement'].includes(value.type as string)
    && (value.image === undefined || typeof value.image === 'string')
    && (value.version === undefined || typeof value.version === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
