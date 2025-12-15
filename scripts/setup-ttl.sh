#!/bin/bash

# Array of collection group names
COLLECTIONS=(
    "corosAPIWorkoutQueue"
    "corosAPIHistoryImportWorkoutQueue"
    "suuntoAppWorkoutQueue"
    "suuntoAppHistoryImportWorkoutQueue"
    "garminHealthAPIActivityQueue"
)

# Field name for TTL
FIELD_NAME="expireAt"

# Get the current project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" == "(unset)" ]; then
    PROJECT_ID="quantified-self-io"
fi

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
