#!/usr/bin/env bash
set -euo pipefail

# Publish Nostr notification for new releases
# Usage: ./scripts/publish-nostr.sh [published_packages_json]
#
# Environment variables:
#   NOSTR_KEY: Nostr private key (nsec or hex). If not provided, runs in dry-run mode.
#   GITHUB_REPOSITORY: Repository name (e.g., "owner/repo"). Defaults to git remote.

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Require nak to be installed
if ! command -v nak &> /dev/null; then
  echo -e "${RED}Error: nak CLI is required but not found${NC}"
  echo ""
  echo "Install nak from: https://github.com/fiatjaf/nak"
  echo ""
  echo "On Linux:"
  echo "  curl -L https://github.com/fiatjaf/nak/releases/latest/download/nak-linux-amd64 -o /tmp/nak"
  echo "  sudo mv /tmp/nak /usr/local/bin/nak"
  echo "  sudo chmod +x /usr/local/bin/nak"
  echo ""
  echo "On macOS:"
  echo "  brew install fiatjaf/tap/nak"
  echo ""
  exit 1
fi

# Get repository name
if [ -z "${GITHUB_REPOSITORY:-}" ]; then
  GITHUB_REPOSITORY=$(git remote get-url origin | sed 's/.*github\.com[:/]\(.*\)\.git/\1/' || echo "unknown/repo")
fi

# Parse published packages JSON
PUBLISHED_PACKAGES_JSON="${1:-}"
if [ -z "$PUBLISHED_PACKAGES_JSON" ]; then
  echo -e "${YELLOW}Warning: No published packages JSON provided${NC}"
  echo "Usage: $0 '[{\"name\":\"pkg\",\"version\":\"1.0.0\"}]'"
  echo ""
  echo "Using example data for testing..."
  PUBLISHED_PACKAGES_JSON='[{"name":"marmot-ts","version":"0.1.0"}]'
fi

# Parse published packages into a comma-separated list
PACKAGES=$(echo "$PUBLISHED_PACKAGES_JSON" | jq -r '.[] | "\(.name)@\(.version)"' | paste -sd ", ")

if [ -z "$PACKAGES" ]; then
  echo -e "${RED}Error: Could not parse published packages${NC}"
  exit 1
fi

# Get the latest changelog entry from CHANGELOG.md
if [ -f "CHANGELOG.md" ]; then
  CHANGELOG=$(awk '/^## /{if(++count==2) exit} count==1' CHANGELOG.md | tail -n +2 | sed 's/^$//' | head -c 500)
else
  echo -e "${YELLOW}Warning: CHANGELOG.md not found${NC}"
  CHANGELOG="No changelog available"
fi

# Compose the message using a heredoc
MESSAGE=$(cat <<EOF
🚀 New Release: ${GITHUB_REPOSITORY}

Published packages:
${PACKAGES}

${CHANGELOG}
EOF
)

# Check if NOSTR_KEY is provided
if [ -z "${NOSTR_KEY:-}" ]; then
  echo -e "${YELLOW}=== DRY RUN MODE ===${NC}"
  echo -e "${BLUE}NOSTR_KEY not provided. This is what would be published:${NC}"
  echo ""
  echo -e "${GREEN}--- Message ---${NC}"
  echo "$MESSAGE"
  echo ""
  echo -e "${GREEN}--- Relays ---${NC}"
  echo "  - wss://relay.damus.io"
  echo "  - wss://nos.lol"
  echo "  - wss://relay.nostr.band"
  echo ""
  echo -e "${YELLOW}To publish for real, set the NOSTR_KEY environment variable:${NC}"
  echo "  export NOSTR_KEY='your-nsec-or-hex-key'"
  echo "  $0 '$PUBLISHED_PACKAGES_JSON'"
  exit 0
fi

# Publish to Nostr relays
echo -e "${GREEN}Publishing to Nostr...${NC}"
echo "$MESSAGE" | nak event --kind 1 --sec "$NOSTR_KEY" \
  --relay wss://relay.damus.io \
  --relay wss://nos.lol \
  --relay wss://relay.nostr.band

echo -e "${GREEN}✓ Successfully published to Nostr!${NC}"
