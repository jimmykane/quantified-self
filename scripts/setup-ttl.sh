#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INDEXES_FILE="$REPO_ROOT/firestore.indexes.json"

# Field name for TTL
FIELD_NAME="expireAt"

# Set the project ID to quantified-self-io to prevent accidental runs on other projects
PROJECT_ID="quantified-self-io"

if ! command -v node >/dev/null 2>&1; then
    echo "Error: node is required to read Firestore TTL configuration."
    exit 1
fi

if [ ! -f "$INDEXES_FILE" ]; then
    echo "Error: Firestore indexes file not found at $INDEXES_FILE"
    exit 1
fi

COLLECTIONS=()
while IFS= read -r collection_group; do
    if [ -n "$collection_group" ]; then
        COLLECTIONS+=("$collection_group")
    fi
done < <(node - "$INDEXES_FILE" <<'NODE'
const fs = require('fs');

const indexesPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(indexesPath, 'utf8'));
const ttlCollectionGroups = [...new Set(
    (config.fieldOverrides || [])
        .filter((entry) => entry.ttl === true && typeof entry.collectionGroup === 'string')
        .map((entry) => entry.collectionGroup.trim())
        .filter(Boolean)
)].sort();

for (const collectionGroup of ttlCollectionGroups) {
    console.log(collectionGroup);
}
NODE
)

if [ "${#COLLECTIONS[@]}" -eq 0 ]; then
    echo "Error: No TTL-enabled collection groups found in $INDEXES_FILE"
    exit 1
fi

echo "Using project ID: $PROJECT_ID"
echo "Reading TTL collection groups from: $INDEXES_FILE"

echo "Enabling TTL on field '$FIELD_NAME' for the following collections:"

for collection in "${COLLECTIONS[@]}"
do
    echo "Processing collection: $collection"
    # Update the TTL policy for the collection group
    # Using '|| true' to continue loop if one fails (e.g., if already exists/updating)
    gcloud firestore fields ttls update "$FIELD_NAME" --collection-group="$collection" --project="$PROJECT_ID" --enable-ttl || true
done

echo "TTL configuration commands sent."
