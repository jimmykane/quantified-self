#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TEST_DIR=$(mktemp -d)
MockGcloud="$TEST_DIR/gcloud"
OutputFile="$TEST_DIR/output.txt"

echo '#!/bin/bash' > "$MockGcloud"
echo 'echo "MOCK_EXEC: gcloud $*"' >> "$MockGcloud"
chmod +x "$MockGcloud"

# Add temp dir to PATH
export PATH="$TEST_DIR:$PATH"

echo "Running setup-ttl.sh with mocked gcloud..."
bash "$REPO_ROOT/scripts/setup-ttl.sh" | tee "$OutputFile"

if ! grep -q 'Processing collection: routeSyncQueue' "$OutputFile"; then
    echo "Expected routeSyncQueue to be included in TTL setup output."
    exit 1
fi

if ! grep -q 'Processing collection: queueCleanupTombstones' "$OutputFile"; then
    echo "Expected queueCleanupTombstones to be included in TTL setup output."
    exit 1
fi

# Cleanup
rm -rf "$TEST_DIR"
