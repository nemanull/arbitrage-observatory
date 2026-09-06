#!/usr/bin/env bash
#
# Clears the observatory's Redis, which in practice means the BullMQ queue behind
# OpportunityWorker: closed opportunities waiting to be written, plus the completed and
# failed job history the worker keeps.
#
# The container is named explicitly and never discovered, because this host runs several
# other Redis containers belonging to other projects. Guessing "the redis one" would
# eventually flush somebody else's queue.
#
# Usage:
#   scripts/redis-flush.sh                 # show what would go, ask, then flush
#   scripts/redis-flush.sh -y              # no prompt
#   scripts/redis-flush.sh --dry-run       # report only, change nothing
#   scripts/redis-flush.sh --queue-only    # delete bull:* and leave anything else alone
#   scripts/redis-flush.sh --force         # flush even with jobs still in flight
#
set -euo pipefail

CONTAINER="${REDIS_CONTAINER:-observatory-redis}"
QUEUE="${OPPORTUNITY_QUEUE:-opportunity-closed}"

ASSUME_YES=0
DRY_RUN=0
QUEUE_ONLY=0
FORCE=0

for arg in "$@"; do
  case "$arg" in
    -y|--yes)     ASSUME_YES=1 ;;
    -n|--dry-run) DRY_RUN=1 ;;
    --queue-only) QUEUE_ONLY=1 ;;
    -f|--force)   FORCE=1 ;;
    -h|--help)    sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

redis() { docker exec "$CONTAINER" redis-cli "$@"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "No running container named '$CONTAINER'." >&2
  echo "Start the infrastructure with 'pnpm infra:up', or set REDIS_CONTAINER to override." >&2
  exit 1
fi

# BullMQ spreads one queue over many key types, so ask each key for its own cardinality.
# A missing key reports 0 rather than failing: an empty queue simply has no list to read.
count_key() {
  redis EVAL "
    local t = redis.call('type', KEYS[1])['ok']
    if t == 'list' then return redis.call('llen', KEYS[1])
    elseif t == 'zset' then return redis.call('zcard', KEYS[1])
    elseif t == 'set' then return redis.call('scard', KEYS[1])
    else return 0 end
  " 1 "bull:${QUEUE}:$1"
}

TOTAL_KEYS=$(redis DBSIZE)
WAITING=$(count_key wait)
ACTIVE=$(count_key active)
DELAYED=$(count_key delayed)
PRIORITIZED=$(count_key prioritized)
COMPLETED=$(count_key completed)
FAILED=$(count_key failed)

echo "container:  $CONTAINER"
echo "keys:       $TOTAL_KEYS"
echo "queue:      bull:${QUEUE}"
echo "  waiting     $WAITING"
echo "  active      $ACTIVE"
echo "  delayed     $DELAYED"
echo "  prioritized $PRIORITIZED"
echo "  completed   $COMPLETED"
echo "  failed      $FAILED"

if [ "$TOTAL_KEYS" -eq 0 ]; then
  echo
  echo "Already empty, nothing to do."
  exit 0
fi

# Waiting, active, delayed and prioritized jobs are closed opportunities that have not reached
# Postgres yet. Flushing them is silent data loss with no way to tell afterwards that it happened,
# so it takes --force. Completed and failed are history and are what this script is normally for.
PENDING=$((WAITING + ACTIVE + DELAYED + PRIORITIZED))
if [ "$PENDING" -gt 0 ] && [ "$FORCE" -ne 1 ]; then
  echo
  echo "Refusing: $PENDING job(s) have not been written to Postgres yet." >&2
  echo "Start the server so the worker drains them, or pass --force to discard them." >&2
  exit 1
fi

if [ "$QUEUE_ONLY" -eq 1 ]; then
  ACTION="delete every bull:* key"
else
  ACTION="FLUSHALL (every key in every database)"
fi

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run, nothing changed. Would $ACTION."
  exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  printf 'About to %s on %s. Continue? [y/N] ' "$ACTION" "$CONTAINER"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

if [ "$QUEUE_ONLY" -eq 1 ]; then
  # UNLINK rather than DEL so a large queue is reclaimed off the main thread, and one batched call
  # rather than a key-per-exec loop, which on a thousand keys is a thousand container round trips.
  # The script travels as an argument, not on stdin: `docker exec` without -i gives the container no
  # stdin at all, so `redis-cli --eval` would silently read an empty script and delete nothing.
  DELETED=$(redis EVAL "
    local cursor, deleted = '0', 0
    repeat
      local page = redis.call('SCAN', cursor, 'MATCH', 'bull:*', 'COUNT', 1000)
      cursor = page[1]
      if #page[2] > 0 then
        deleted = deleted + redis.call('UNLINK', unpack(page[2]))
      end
    until cursor == '0'
    return deleted
  " 0)
  echo "Deleted $DELETED bull:* key(s)."
else
  redis FLUSHALL > /dev/null
  echo "Flushed."
fi

echo "keys now:   $(redis DBSIZE)"
