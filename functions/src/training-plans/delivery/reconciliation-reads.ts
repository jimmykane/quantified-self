import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import type { DeliveryConnection, DeliveryRuntime } from './contracts';

export interface DeliveryDocumentReader {
  get(reference: DocumentReference): Promise<DocumentSnapshot>;
}

/** One page, owner and transaction attempt only. Never reuse across retries or provider requests. */
export class ReconciliationReads implements DeliveryDocumentReader {
  private readonly documents = new Map<string, Promise<DocumentSnapshot>>();
  private readonly connections = new Map<PlannedWorkoutProviderId, Promise<DeliveryConnection>>();

  constructor(private readonly runtime: DeliveryRuntime, private readonly tx: Transaction, private readonly uid: string) {}

  get(reference: DocumentReference): Promise<DocumentSnapshot> {
    let pending = this.documents.get(reference.path);
    if (!pending) {
      pending = this.tx.get(reference);
      this.documents.set(reference.path, pending);
    }
    return pending;
  }

  connection(provider: PlannedWorkoutProviderId): Promise<DeliveryConnection> {
    let pending = this.connections.get(provider);
    if (!pending) {
      pending = this.runtime.connection(this.tx, this.uid, provider);
      this.connections.set(provider, pending);
    }
    return pending;
  }
}
