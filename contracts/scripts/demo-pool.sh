#!/usr/bin/env bash
# Pre-runs a complete 3-day pool with 3 wallets so you can show a finished payout in the demo.
# A and B verify every day, C misses day 2 → A and B split 90% of C's stake, 10% to treasury.
#
#   export RPC=https://testnet-rpc.monad.xyz
#   export POOL=0xDeployedCommitPool
#   export ORACLE_KEY=0x...          # oracle private key (same one Vercel uses)
#   export PK_A=0x... PK_B=0x... PK_C=0x...   # burner TESTNET wallets with some MON each
#   bash contracts/scripts/demo-pool.sh
# Optional: DAY (default 60), WINDOW (default 20), DAYS (default 3), STAKE (wei, default 0.05 MON)
set -euo pipefail
: "${RPC:?}" "${POOL:?}" "${ORACLE_KEY:?}" "${PK_A:?}" "${PK_B:?}" "${PK_C:?}"
DAY=${DAY:-60}; WINDOW=${WINDOW:-20}; DAYS=${DAYS:-3}; STAKE=${STAKE:-50000000000000000}
A=$(cast wallet address --private-key "$PK_A"); B=$(cast wallet address --private-key "$PK_B"); C=$(cast wallet address --private-key "$PK_C")
tx() { cast send "$POOL" "$@" --rpc-url "$RPC" >/dev/null; }
wait_until() { while [ "$(date +%s)" -lt "$1" ]; do sleep 1; done; }
verify() { # $1 key, $2 address, $3 day
  local h sig
  h=$(cast call "$POOL" "attestationHash(uint256,address,uint8)(bytes32)" "$ID" "$2" "$3" --rpc-url "$RPC")
  sig=$(cast wallet sign --private-key "$ORACLE_KEY" "$h")
  tx "submit(uint256,bytes)" "$ID" "$sig" --private-key "$1"
}

START=$(( $(date +%s) + WINDOW + 40 ))
tx "createPool(string,uint128,uint64,uint32,uint32,uint8,uint8)" "In bed by 23:00" "$STAKE" "$START" "$DAY" "$WINDOW" "$DAYS" 4 --value "$STAKE" --private-key "$PK_A"
ID=$(cast call "$POOL" "poolCount()(uint256)" --rpc-url "$RPC")
echo "Pool $ID created; first deadline at $START"
tx "joinPool(uint256)" "$ID" --value "$STAKE" --private-key "$PK_B"
tx "joinPool(uint256)" "$ID" --value "$STAKE" --private-key "$PK_C"

for (( d=0; d<DAYS; d++ )); do
  wait_until $(( START + d * DAY ))
  verify "$PK_A" "$A" "$d"; verify "$PK_B" "$B" "$d"
  if [ "$d" -ne 1 ]; then verify "$PK_C" "$C" "$d"; else echo "  C misses day 2"; fi
  echo "Day $((d+1)) done"
done

wait_until $(( START + (DAYS - 1) * DAY + WINDOW + 5 ))
tx "settle(uint256)" "$ID" --private-key "$PK_A"
tx "claim(uint256)" "$ID" --private-key "$PK_A"
tx "claim(uint256)" "$ID" --private-key "$PK_B"
if cast send "$POOL" "claim(uint256)" "$ID" --private-key "$PK_C" --rpc-url "$RPC" >/dev/null 2>&1; then echo "UNEXPECTED: C claimed"; exit 1; fi
echo "Pool $ID settled. Fees accrued: $(cast call "$POOL" "feesAccrued()(uint256)" --rpc-url "$RPC")"
echo "Open it in the app with ?pool=$ID"
