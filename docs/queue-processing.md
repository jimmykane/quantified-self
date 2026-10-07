# Queue Processing Architecture

The application uses a dual-path architecture to process workout and activity data from third-party services (Suunto, Garmin, COROS, and Wahoo). This ensures both responsiveness (immediate processing) and reliability (background processing).

## Architecture Overview

1.  **Ingestion Functions**: Receive webhooks or API data and save a "Queue Item" to Firestore.
2.  **Dispatch**: The ingestion function immediately enqueues a Cloud Task pointing to the specific Queue Item.
3.  **Processing**:
    *   **Path A: Immediate Sync (Cloud Tasks)**: A worker function processes the item instantly.
    *   **Path B: Background Sync (Scheduled)**: A scheduled cron job scans for unprocessed items every hour as a safety net.

## Configuration configuration

All queue configuration is centralized in `functions/src/shared/queue-config.ts`.

### 1. Immediate Processing (Cloud Tasks)

*   **Mechanism**: Google Cloud Tasks triggering a 2nd Gen Cloud Function (`processWorkoutTask`).
*   **Retry Policy**:
    *   Max Attempts: 8
    *   Backoff: Exponential (starts at 30s, doubles up to 4 hours).
    *   **Behavior**: If the worker function throws an error, Cloud Tasks automatically retries delivery based on this policy.

### 2. Background Processing (Scheduled)

*   **Mechanism**: Firebase Scheduled Functions (Pub/Sub) running every hour (`0 * * * *`).
*   **Retry Policy**:
    *   Max Attempts: 10 (controlled by `MAX_RETRY_COUNT` constant).
    *   **Behavior**: The function queries Firestore for items where `processed == false` and `retryCount < 10`. If processing fails, it increments the `retryCount` field on the Firestore document.

### 3. Data Retention

*   **TTL**: Queue items in Firestore have a Time-To-Live (TTL) of 7 days (`QUEUE_ITEM_TTL_MS`). After this period, they should be cleaned up (currently manual or via separate cleanup policies).

## Code Structure

*   `functions/src/shared/queue-config.ts`: Centralized constants.
*   `functions/src/tasks/workout-processor.ts`: Cloud Task worker (Path A).
*   `functions/src/queue.ts`: Shared processing logic and Scheduled Functions (Path B).
*   `functions/src/garmin/queue.ts`: Specialized parsing logic for Garmin formats.
*   `functions/src/wahoo/queue-store.ts`: Idempotent Wahoo webhook/history queue upserts and dispatch.
*   `functions/src/wahoo/processor.ts`: Secure Wahoo FIT download, parsing, and event persistence.

### Training load candidate preservation during ingestion and reparse

The EventWriter backend adapters prepare private Training load evaluations after source writes and before stale activity cleanup. Keep the parsed Activity instances alive until this hook completes. Preparation failures must propagate to the queue/manual reparse caller, rather than marking an event successfully processed without refreshed candidates. The transaction verifies source fingerprints, owner/deletion state and the latest controls, retaining the leg's dated applied policy. Reparse must not reconstruct imported provenance from a previous calculated TSS or use derived TSS to match saved controls. Ambiguous leg identity requires owner review, with no unmatched-leg fallback. See [Training load controls](training-workspace.md#file-only-tss-evaluation-and-owner-load-controls) for calculation, persistence and release rules. Library publication, deployment and a production reparse each require separate approval.
