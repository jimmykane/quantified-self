import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import {
    HealthRangeQuery,
    HealthRangeResult,
    HealthSampleChunk,
    HealthSourceRecord,
} from '../../../shared/health';
import {
    HealthFirestoreQueryPlan,
    planHealthFirestoreQueries,
} from '../../../shared/health-firestore-query';
import { projectHealthRange } from '../../../shared/health-query';

export interface HealthQueryDependencies {
    db?: admin.firestore.Firestore;
    nowMs?: number;
}

function applyQueryPlan(
    collection: admin.firestore.CollectionReference,
    plan: HealthFirestoreQueryPlan,
): admin.firestore.Query {
    let query: admin.firestore.Query = collection
        .where('calendarDate', '>=', plan.startDate)
        .where('calendarDate', '<=', plan.endDate);
    if (plan.filter) {
        query = query.where(plan.filter.field, plan.filter.operator, plan.filter.value);
    }
    query = query
        .orderBy('calendarDate', 'asc')
        .orderBy(FieldPath.documentId(), 'asc');
    if (plan.cursor) {
        query = query.startAfter(plan.cursor.calendarDate, plan.cursor.id);
    }
    return query.limit(plan.fetchLimit);
}

function userCollection(
    db: admin.firestore.Firestore,
    userID: string,
    collectionId: string,
): admin.firestore.CollectionReference {
    return db.collection('users').doc(userID).collection(collectionId);
}

export async function readHealthRange(
    userID: string,
    queryValue: HealthRangeQuery | unknown,
    dependencies: HealthQueryDependencies = {},
): Promise<HealthRangeResult> {
    const db = dependencies.db || admin.firestore();
    const plans = planHealthFirestoreQueries(queryValue);
    const sourceRecordQuery = applyQueryPlan(
        userCollection(db, userID, plans.sourceRecords.collectionId),
        plans.sourceRecords,
    );
    const chunkQuery = plans.chunks
        ? applyQueryPlan(userCollection(db, userID, plans.chunks.collectionId), plans.chunks)
        : null;
    const [sourceRecordSnapshot, chunkSnapshot] = await db.runTransaction(async transaction => Promise.all([
        transaction.get(sourceRecordQuery),
        chunkQuery ? transaction.get(chunkQuery) : Promise.resolve(null),
    ]), { readOnly: true });
    const sourceRecords = sourceRecordSnapshot.docs.map(snapshot => ({
        ...snapshot.data(),
        id: snapshot.id,
    }) as HealthSourceRecord);
    const chunks = (chunkSnapshot?.docs || []).map(snapshot => ({
        ...snapshot.data(),
        id: snapshot.id,
    }) as HealthSampleChunk);
    return projectHealthRange(sourceRecords, chunks, plans.query, dependencies.nowMs);
}
