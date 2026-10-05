#!/bin/sh
# restore.sh — Restore PostgreSQL + storage volume from backup.
# Full implementation in feature 11. This is a stub with clear intent.
#
# When implemented, this script will:
#   1. Accept BACKUP_FILE and STORAGE_ARCHIVE as arguments
#   2. Stop the app service (or warn if it is running)
#   3. psql restore from SQL dump
#   4. Extract storage archive to STORAGE_ROOT
#   5. Verify restore integrity

echo "restore.sh: not yet implemented (feature 11)"
echo "Run this script after feature 11 is complete."
exit 1
