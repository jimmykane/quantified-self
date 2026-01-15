#!/bin/bash

# Array of collection group names
COLLECTIONS=(
    "COROSAPIWorkoutQueue"
    "suuntoAppWorkoutQueue"
    "garminAPIActivityQueue"
    "failed_jobs"
    "mail"
    "orphaned_service_tokens"
)

# Field name for TTL
FIELD_NAME="expireAt"

# Set the project ID to quantified-self-io to prevent accidental runs on other projects
PROJECT_ID="quantified-self-io"

echo "Using project ID: $PROJECT_ID"

echo "Enabling TTL on field '$FIELD_NAME' for the following collections:"

for collection in "${COLLECTIONS[@]}"
do
    echo "Processing collection: $collection"
    # Update the TTL policy for the collection group
    # Using '|| true' to continue loop if one fails (e.g., if already exists/updating)
    gcloud firestore fields ttls update "$FIELD_NAME" --collection-group="$collection" --project="$PROJECT_ID" --enable-ttl || true
done

echo "TTL configuration commands sent."
