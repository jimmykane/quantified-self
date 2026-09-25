import { inject, Injectable } from '@angular/core';
import { normalizeEventTagSuggestions } from '@shared/event-tags';
import { Auth } from 'app/firebase/auth';
import { Firestore, collection, getDocs } from 'app/firebase/firestore';

@Injectable({ providedIn: 'root' })
export class EventTagCatalogService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private readonly cacheLifetimeMs = 2 * 60 * 1000;
  private readonly cache = new Map<string, { expiresAt: number; request: Promise<string[]> }>();
  private owner: object | null = null;
  private locallySavedTags: string[] = [];

  noteSavedTags(userID: string, values: string[]): void {
    if (!this.isCurrentOwner(userID)) return;
    this.locallySavedTags = normalizeEventTagSuggestions([...this.locallySavedTags, ...values]);
  }

  async listAllTags(userID: string, refresh = false): Promise<string[]> {
    const authUser = this.auth.currentUser;
    if (!authUser || authUser.uid !== userID) {
      throw new Error('Activity tags are only available for the signed-in account.');
    }
    this.isCurrentOwner(userID);
    const canExecute = () => this.auth.currentUser === authUser;
    const cached = this.cache.get(userID);
    const request = !refresh && cached && cached.expiresAt > Date.now()
      ? cached.request
      : getDocs(collection(this.firestore, 'users', userID, 'eventTagCatalog')).then(snapshot =>
        normalizeEventTagSuggestions(snapshot.docs.map(document => document.data()?.['name'])));
    if (request !== cached?.request) {
      this.cache.set(userID, { expiresAt: Date.now() + this.cacheLifetimeMs, request });
    }
    try {
      const tags = await request;
      if (!canExecute()) {
        throw new Error('The signed-in account changed while loading activity tags.');
      }
      return normalizeEventTagSuggestions([...tags, ...this.locallySavedTags])
        .sort((first, second) => first.localeCompare(second));
    } catch (error) {
      if (this.cache.get(userID)?.request === request) {
        this.cache.delete(userID);
      }
      throw error;
    }
  }

  private isCurrentOwner(userID: string): boolean {
    const current = this.auth.currentUser;
    if (!current || current.uid !== userID) return false;
    if (this.owner !== current) {
      this.owner = current;
      this.cache.clear();
      this.locallySavedTags = [];
    }
    return true;
  }
}
