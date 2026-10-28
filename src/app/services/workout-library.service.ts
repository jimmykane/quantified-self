import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, getDoc } from 'app/firebase/firestore';
import { map, type Observable } from 'rxjs';
import {
  WORKOUT_LIBRARY_COLLECTION_ID,
  parseWorkoutLibraryItemV1,
  type MutateWorkoutLibraryRequestV1,
  type MutateWorkoutLibraryResponseV1,
  type PlaceWorkoutLibraryRequestV1,
  type PlaceWorkoutLibraryResponseV1,
  type WorkoutLibraryItemV1,
} from '@shared/workout-library';
import { AppFunctionsService } from './app.functions.service';

@Injectable({ providedIn: 'root' })
export class WorkoutLibraryService {
  private readonly db = inject(Firestore);
  private readonly functions = inject(AppFunctionsService);

  watch(uid: string): Observable<WorkoutLibraryItemV1[]> {
    return collectionData(collection(this.db, 'users', uid, WORKOUT_LIBRARY_COLLECTION_ID)).pipe(
      map(values => values.map(parseWorkoutLibraryItemV1)
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.title.localeCompare(b.title))),
    );
  }

  async get(uid: string, itemId: string): Promise<WorkoutLibraryItemV1 | null> {
    const snapshot = await getDoc(doc(this.db, 'users', uid, WORKOUT_LIBRARY_COLLECTION_ID, itemId));
    return snapshot.exists() ? parseWorkoutLibraryItemV1(snapshot.data()) : null;
  }

  async mutate(request: MutateWorkoutLibraryRequestV1): Promise<MutateWorkoutLibraryResponseV1> {
    return (await this.functions.call<MutateWorkoutLibraryRequestV1, MutateWorkoutLibraryResponseV1>(
      'mutateWorkoutLibrary', request)).data;
  }

  async place(request: PlaceWorkoutLibraryRequestV1): Promise<PlaceWorkoutLibraryResponseV1> {
    return (await this.functions.call<PlaceWorkoutLibraryRequestV1, PlaceWorkoutLibraryResponseV1>(
      'placeWorkoutLibrary', request)).data;
  }
}
