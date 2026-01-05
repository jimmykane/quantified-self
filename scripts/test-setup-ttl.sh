#!/bin/bash

# Mock gcloud function
gcloud() {
    echo "MOCK gcloud: $*"
}

# Export the function so it's visible to the sourced script if we were sourcing
# But since we are running the script in a subshell, we can't easily override the command unless we modify the PATH or use an alias.
# A simpler way to "test" a bash script without executing side effects is often to inspect it or use a dry-run flag if supported.
# Since the script calls 'gcloud' directly, we can create a temporary 'gcloud' executable in the PATH.

TEST_DIR=$(mktemp -d)
MockGcloud="$TEST_DIR/gcloud"

echo '#!/bin/bash' > "$MockGcloud"
echo 'echo "MOCK_EXEC: gcloud $*"' >> "$MockGcloud"
chmod +x "$MockGcloud"

# Add temp dir to PATH
export PATH="$TEST_DIR:$PATH"

echo "Running setup-ttl.sh with mocked gcloud..."
./scripts/setup-ttl.sh

# Cleanup
rm -rf "$TEST_DIR"
