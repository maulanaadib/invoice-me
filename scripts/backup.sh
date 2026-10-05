#!/bin/sh
# backup.sh — PostgreSQL + storage volume backup.
# Full implementation in feature 11. This is a stub with clear intent.
#
# When implemented, this script will:
#   1. pg_dump DATABASE_URL → compressed SQL file (timestamped)
#   2. tar + compress STORAGE_ROOT → archive
#   3. Store both in BACKUP_DEST (local or S3-compatible)
#   4. Rotate old backups per retention policy

echo "backup.sh: not yet implemented (feature 11)"
echo "Run this script after feature 11 is complete."
exit 1
