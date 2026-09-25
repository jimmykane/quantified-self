import { inject, Injectable } from '@angular/core';
import { Auth } from 'app/firebase/auth';
import { AppFunctionsService } from './app.functions.service';

@Injectable({ providedIn: 'root' })
export class EventTagCatalogService {
  private functionsService = inject(AppFunctionsService);
  private auth = inject(Auth);
  private readonly cacheLifetimeMs = 2 * 60 * 1000;
  private readonly cache = new Map<string, { expiresAt: number; request: Promise<string[]> }>();

  async listAllTags(userID: string, refresh = false): Promise<string[]> {
    const authUser = this.auth.currentUser;
    if (!authUser || authUser.uid !== userID) {
      throw new Error('Activity tags are only available for the signed-in account.');
    }
    const cached = this.cache.get(userID);
    if (!refresh && cached && cached.expiresAt > Date.now()) {
      return cached.request;
    }

    // The user ID is only a local cache key; the callable derives its owner from Auth.
    const canExecute = () => this.auth.currentUser === authUser;
    const request = this.functionsService.call<undefined, { tags: string[] }>(
      'listEventTags', undefined, { canExecute },
    ).then(response => {
      if (!canExecute()) {
        throw new Error('The signed-in account changed while loading activity tags.');
      }
      return response.data.tags;
    });
    this.cache.set(userID, { expiresAt: Date.now() + this.cacheLifetimeMs, request });
    try {
      return await request;
    } catch (error) {
      if (this.cache.get(userID)?.request === request) {
        this.cache.delete(userID);
      }
      throw error;
    }
  }
}
