#!/bin/bash
set -e

# Configuration
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

# Fallback: Try to read from .firebaserc
if [ -z "$PROJECT_ID" ] && [ -f ".firebaserc" ]; then
  PROJECT_ID=$(grep '"default"' .firebaserc | head -n 1 | sed 's/.*"default": "\(.*\)".*/\1/')
fi

if [ -z "$PROJECT_ID" ]; then
  echo "Error: Could not determine default Google Cloud Project ID."
  echo "Please set it with: gcloud config set project YOUR_PROJECT_ID"
  echo "Or ensure .firebaserc exists and has a default project."
  exit 1
fi

echo "============================================="
echo "Firestore Cleanup Script - Hybrid Mode"
echo "Project: $PROJECT_ID"
echo "============================================="

# Define Collection Groups in Bottom-Up Order
# Arrays in Bash
COLLECTION_GROUPS=(
    "streams"
    "activities"
    "tokens"
    "events"
    "meta"
    "athletes"
    "users"
    "coaches"
    "garminHealthAPITokens"
    "suuntoAppAccessTokens"
    "stravaTokens"
    "polarAccessTokens"
    "fitbitAccessTokens"
    "garminHealthAPIActivityQueue"
    "suuntoAppWorkoutQueue"
)

# 1. Dry Run / Analysis Phase (Node.js)
echo ""
echo "--- Phase 1: Analysis (Dry Run) ---"
echo "Counting documents using firebase-admin..."

# Inline Node.js script to count documents
# We run this from the 'functions' directory to access node_modules
cd functions

PROJECT_ID="$PROJECT_ID" node -e '
const admin = require("firebase-admin");

// Initialize with ADC (Standard)
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.PROJECT_ID
    });
}
const db = admin.firestore();

const GROUPS = [
    "streams", "activities", "tokens", 
    "events", "meta", "athletes", 
    "users", "coaches", 
    "garminHealthAPITokens", "suuntoAppAccessTokens", "stravaTokens", 
    "polarAccessTokens", "fitbitAccessTokens", 
    "garminHealthAPIActivityQueue", "suuntoAppWorkoutQueue"
];

async function countAll() {
    let totalDocs = 0;
    console.log("Collection Group Counts:");
    
    // Check connection first
    try {
        await db.listCollections(); 
    } catch (e) {
        if (e.message.includes("credential")) {
            console.error("\n[ERROR] Authentication Failed.");
            console.error("Please run: gcloud auth application-default login");
            console.error("Then try again.\n");
            process.exit(1);
        }
    }

    for (const group of GROUPS) {
        try {
            // Using aggregation query count()
            const snap = await db.collectionGroup(group).count().get();
            const count = snap.data().count;
            if (count > 0) {
                console.log(`  [${group}]: ${count} documents`);
                totalDocs += count;
            }
        } catch (e) {
             if (e.message.includes("credential") || e.code === "unauthenticated") {
                console.error(`  [${group}]: Auth Error - Missing ADC.`);
             } else {
                console.error(`  [${group}]: Error - ${e.message}`);
             }
        }
    }
    console.log(`\nTotal Documents Found: ${totalDocs}`);
}

countAll().catch(err => {
    console.error("Script failed:", err);
    process.exit(1);
});
'


if [ $? -ne 0 ]; then
    echo "Dry run analysis failed. Please fix the errors above."
    exit 1
fi

echo ""
echo "--- Service Deauthorization Analysis ---"
# Run deauthorization logic in dry-run mode
# We are currently in 'functions' directory
export NODE_PATH=./node_modules
# Pass PROJECT_ID explicitly to the node process environment
PROJECT_ID="$PROJECT_ID" node ../scripts/deauthorize_users.js --dry-run



cd ..

echo ""
echo "---------------------------------------------"
echo "Analysis Complete."
echo ""

# 2. Confirmation / Execution Phase
if [[ "$1" == "--force" ]]; then
    echo "Force flag detected. Proceeding with deletion..."
else
    read -p "Do you want to proceed with DELETING these collections? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Operation cancelled."
        exit 0
    fi
fi

echo ""
echo "--- Phase 2: Execution (Bulk Delete) ---"
echo "Starting deletion in Bottom-Up order..."

echo "Performing Service Deauthorization..."
export NODE_PATH=./functions/node_modules
# Pass PROJECT_ID explicitly
PROJECT_ID="$PROJECT_ID" node scripts/deauthorize_users.js

for group in "${COLLECTION_GROUPS[@]}"; do
    echo "Deleting collection group: [$group]..."
    
    # Run gcloud delete
    # --quiet disables interactive prompts (we already asked)
    gcloud alpha firestore bulk-delete \
        --collection-ids="$group" \
        --project="$PROJECT_ID" \
        --quiet || echo "Warning: Failed to delete group $group or empty."
        
    echo "Completed group: [$group]"
done

echo ""
echo "============================================="
echo "Cleanup Complete."
echo "============================================="
