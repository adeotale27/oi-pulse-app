#!/usr/bin/env python3
"""
Backend regression test — round 9
CRITICAL: DB refresh (Fresh Pull) endpoint exhaustive verification
User is impatient about this specific feature - be thorough.
"""

import os
import requests
import time
from datetime import datetime

# Backend URL from review request
BASE_URL = "https://oi-api-trace.preview.emergentagent.com/api"

# Admin credentials from /app/memory/test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = (os.environ.get("ADMIN_PASSWORD") or "").strip()
if not ADMIN_PASSWORD:
    raise SystemExit("Set ADMIN_PASSWORD env var to run this test (do not hardcode secrets).")

# Track login attempts (constraint: ≤5 total)
login_attempts = 0

def login_admin():
    """Login as admin and return token. Track attempts."""
    global login_attempts
    login_attempts += 1
    print(f"\n[LOGIN ATTEMPT {login_attempts}/5]")
    
    resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
        timeout=10
    )
    resp.raise_for_status()
    data = resp.json()
    print(f"✅ Admin login successful: {data.get('username')}")
    return data["token"]


def test_task1_refresh_day_endpoint():
    """
    TASK 1 — POST /api/admin/refresh-day
    
    Requirements:
    - Log in as admin (ONE call), capture X-Admin-Token.
    - POST /api/admin/refresh-day → HTTP 200.
    - Assert response.ok == true.
    - Assert response.deleted is an integer >= 0.
    - Assert response.backfilled_snapshots >= 1000 (expected ~1128 = 376 per index × 3).
    - Assert response.per_index_count is a dict. For EACH of NIFTY, SENSEX, BANKNIFTY, 
      assert per_index_count[idx] >= 375.
    - Assert response.mode is one of ["kite", "mock"].
    - Assert response.indices_backfilled == ["NIFTY", "SENSEX", "BANKNIFTY"] (order-insensitive).
    - Assert response.message is a non-empty string containing the phrase "Fresh Pull".
    - Wait 3 seconds.
    - For each idx in [NIFTY, SENSEX, BANKNIFTY]: GET /api/history/{idx}?minutes=1440 
      → HTTP 200 with response.count >= 375.
    """
    print("\n" + "="*80)
    print("TASK 1 — POST /api/admin/refresh-day EXHAUSTIVE VERIFICATION")
    print("="*80)
    
    # Step 1: Admin Login (ONE call only)
    print("\n[Step 1: Admin Login]")
    admin_token = login_admin()
    headers = {"X-Admin-Token": admin_token}
    
    # Step 2: POST /api/admin/refresh-day
    print("\n[Step 2: POST /api/admin/refresh-day]")
    print(f"  Endpoint: {BASE_URL}/admin/refresh-day")
    
    start_time = time.time()
    resp = requests.post(f"{BASE_URL}/admin/refresh-day", headers=headers, timeout=60)
    elapsed = time.time() - start_time
    
    print(f"  Status: {resp.status_code}")
    print(f"  Response time: {elapsed:.2f}s")
    
    assert resp.status_code == 200, f"Expected HTTP 200, got {resp.status_code}"
    print(f"  ✅ HTTP 200 OK")
    
    data = resp.json()
    print(f"\n[Step 3: Response Validation]")
    print(f"  Full response: {data}")
    
    # Assert response.ok == true
    ok = data.get("ok")
    print(f"\n  [3.1] ok: {ok}")
    assert ok is True, f"Expected ok=true, got {ok}"
    print(f"  ✅ response.ok == true")
    
    # Assert response.deleted is an integer >= 0
    deleted = data.get("deleted")
    print(f"\n  [3.2] deleted: {deleted} (type: {type(deleted).__name__})")
    assert isinstance(deleted, int), f"Expected deleted to be int, got {type(deleted)}"
    assert deleted >= 0, f"Expected deleted >= 0, got {deleted}"
    print(f"  ✅ response.deleted is an integer >= 0: {deleted}")
    
    # Assert response.backfilled_snapshots >= 1000
    backfilled_snapshots = data.get("backfilled_snapshots")
    print(f"\n  [3.3] backfilled_snapshots: {backfilled_snapshots}")
    assert isinstance(backfilled_snapshots, int), \
        f"Expected backfilled_snapshots to be int, got {type(backfilled_snapshots)}"
    assert backfilled_snapshots >= 1000, \
        f"Expected backfilled_snapshots >= 1000 (expected ~1128 = 376 per index × 3), got {backfilled_snapshots}"
    print(f"  ✅ response.backfilled_snapshots >= 1000: {backfilled_snapshots}")
    
    # Assert response.per_index_count is a dict
    per_index_count = data.get("per_index_count")
    print(f"\n  [3.4] per_index_count: {per_index_count}")
    assert isinstance(per_index_count, dict), \
        f"Expected per_index_count to be dict, got {type(per_index_count)}"
    print(f"  ✅ response.per_index_count is a dict")
    
    # For EACH of NIFTY, SENSEX, BANKNIFTY, assert per_index_count[idx] >= 375
    print(f"\n  [3.5] Validating per_index_count for each index:")
    for idx in ["NIFTY", "SENSEX", "BANKNIFTY"]:
        count = per_index_count.get(idx)
        print(f"    {idx}: {count}")
        assert count is not None, f"Expected per_index_count['{idx}'] to exist, got None"
        assert isinstance(count, int), f"Expected per_index_count['{idx}'] to be int, got {type(count)}"
        assert count >= 375, f"Expected per_index_count['{idx}'] >= 375, got {count}"
        print(f"    ✅ {idx}: {count} >= 375")
    
    # Assert response.mode is one of ["kite", "mock"]
    mode = data.get("mode")
    print(f"\n  [3.6] mode: {mode}")
    assert mode in ["kite", "mock"], f"Expected mode in ['kite', 'mock'], got '{mode}'"
    print(f"  ✅ response.mode is one of ['kite', 'mock']: {mode}")
    
    # Assert response.indices_backfilled == ["NIFTY", "SENSEX", "BANKNIFTY"] (order-insensitive)
    indices_backfilled = data.get("indices_backfilled", [])
    print(f"\n  [3.7] indices_backfilled: {indices_backfilled}")
    expected_indices = ["NIFTY", "SENSEX", "BANKNIFTY"]
    assert sorted(indices_backfilled) == sorted(expected_indices), \
        f"Expected indices_backfilled == {expected_indices} (order-insensitive), got {indices_backfilled}"
    print(f"  ✅ response.indices_backfilled == {expected_indices} (order-insensitive)")
    
    # Assert response.message is a non-empty string containing the phrase "Fresh Pull"
    message = data.get("message")
    print(f"\n  [3.8] message: {message}")
    assert isinstance(message, str), f"Expected message to be str, got {type(message)}"
    assert len(message) > 0, f"Expected message to be non-empty, got empty string"
    assert "Fresh Pull" in message, f"Expected message to contain 'Fresh Pull', got: {message}"
    print(f"  ✅ response.message is a non-empty string containing 'Fresh Pull'")
    
    # Wait 3 seconds
    print(f"\n[Step 4: Wait 3 seconds for data to settle]")
    time.sleep(3)
    print(f"  ✅ Waited 3 seconds")
    
    # For each idx in [NIFTY, SENSEX, BANKNIFTY]: GET /api/history/{idx}?minutes=1440
    print(f"\n[Step 5: Verify history for each index]")
    history_results = []
    
    for idx in ["NIFTY", "SENSEX", "BANKNIFTY"]:
        print(f"\n  [Testing {idx}]")
        resp = requests.get(f"{BASE_URL}/history/{idx}?minutes=1440", timeout=10)
        print(f"    Status: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200 for {idx}, got {resp.status_code}"
        print(f"    ✅ HTTP 200 OK")
        
        data = resp.json()
        count = data.get("count", 0)
        print(f"    count: {count}")
        assert count >= 375, f"Expected count >= 375 for {idx}, got {count}"
        print(f"    ✅ {idx}: response.count >= 375 ({count} snapshots)")
        
        history_results.append({"index": idx, "count": count})
    
    print("\n" + "="*80)
    print("TASK 1 SUMMARY")
    print("="*80)
    print(f"✅ Admin login successful (1 login used)")
    print(f"✅ POST /api/admin/refresh-day: HTTP 200 OK")
    print(f"✅ response.ok == true")
    print(f"✅ response.deleted: {deleted} (integer >= 0)")
    print(f"✅ response.backfilled_snapshots: {backfilled_snapshots} (>= 1000)")
    print(f"✅ response.per_index_count:")
    for idx in ["NIFTY", "SENSEX", "BANKNIFTY"]:
        print(f"   - {idx}: {per_index_count[idx]} (>= 375)")
    print(f"✅ response.mode: {mode} (in ['kite', 'mock'])")
    print(f"✅ response.indices_backfilled: {indices_backfilled} (matches expected)")
    print(f"✅ response.message contains 'Fresh Pull': YES")
    print(f"✅ History verification:")
    for r in history_results:
        print(f"   - {r['index']}: {r['count']} snapshots (>= 375)")
    print("✅ TASK 1 PASSED: All assertions passed")
    
    return {
        "deleted": deleted,
        "backfilled_snapshots": backfilled_snapshots,
        "per_index_count": per_index_count,
        "mode": mode,
        "indices_backfilled": indices_backfilled,
        "message": message,
        "history_results": history_results
    }


def test_task2_timeframe_distinctness():
    """
    TASK 2 — Timeframe distinctness after Fresh Pull
    
    Requirements:
    - For M in [5, 10, 15, 30, 60, 375]:
      - GET /api/oi/NIFTY/change?minutes={M} → HTTP 200.
      - Assert response.current is not null.
      - Assert response.previous is not null.
      - Assert response.history_ready == true.
      - Capture response.previous.timestamp as prev_ts[M].
    - After collecting all six, assert that the six prev_ts values are ALL DIFFERENT 
      (set(prev_ts.values()) has 6 entries).
    - For M in [5, 60, 375]: assert response.available_history_minutes is within ±5 minutes 
      of M (i.e. abs(avail - M) <= 5 for small values; for M=375 allow ±10 min tolerance 
      since minute-cadence backfill).
    """
    print("\n" + "="*80)
    print("TASK 2 — TIMEFRAME DISTINCTNESS AFTER FRESH PULL")
    print("="*80)
    
    timeframes = [5, 10, 15, 30, 60, 375]
    prev_ts = {}
    available_history = {}
    
    print(f"\n[Step 1: Test all timeframes for NIFTY]")
    
    for M in timeframes:
        print(f"\n  [Testing minutes={M}]")
        resp = requests.get(f"{BASE_URL}/oi/NIFTY/change?minutes={M}", timeout=10)
        print(f"    Status: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200 for minutes={M}, got {resp.status_code}"
        print(f"    ✅ HTTP 200 OK")
        
        data = resp.json()
        
        # Assert response.current is not null
        current = data.get("current")
        print(f"    current: {'not null' if current else 'NULL'}")
        assert current is not None, f"Expected current to be not null for minutes={M}, got null"
        print(f"    ✅ response.current is not null")
        
        # Assert response.previous is not null
        previous = data.get("previous")
        print(f"    previous: {'not null' if previous else 'NULL'}")
        assert previous is not None, f"Expected previous to be not null for minutes={M}, got null"
        print(f"    ✅ response.previous is not null")
        
        # Assert response.history_ready == true
        history_ready = data.get("history_ready")
        print(f"    history_ready: {history_ready}")
        assert history_ready is True, f"Expected history_ready == true for minutes={M}, got {history_ready}"
        print(f"    ✅ response.history_ready == true")
        
        # Capture response.previous.timestamp
        prev_timestamp = previous.get("timestamp")
        print(f"    previous.timestamp: {prev_timestamp}")
        assert prev_timestamp is not None, f"Expected previous.timestamp to exist for minutes={M}, got null"
        prev_ts[M] = prev_timestamp
        print(f"    ✅ Captured previous.timestamp: {prev_timestamp}")
        
        # Capture available_history_minutes
        avail_hist = data.get("available_history_minutes")
        print(f"    available_history_minutes: {avail_hist}")
        available_history[M] = avail_hist
    
    # Assert that the six prev_ts values are ALL DIFFERENT
    print(f"\n[Step 2: Verify all previous timestamps are DIFFERENT]")
    print(f"  Collected timestamps:")
    for M, ts in prev_ts.items():
        print(f"    minutes={M}: {ts}")
    
    unique_timestamps = set(prev_ts.values())
    print(f"\n  Unique timestamps count: {len(unique_timestamps)}")
    print(f"  Expected: 6 unique timestamps")
    assert len(unique_timestamps) == 6, \
        f"Expected 6 DIFFERENT previous timestamps, got {len(unique_timestamps)} unique values. " \
        f"Timestamps: {prev_ts}"
    print(f"  ✅ All 6 previous timestamps are DIFFERENT")
    
    # For M in [5, 60, 375]: assert available_history_minutes is within tolerance
    print(f"\n[Step 3: Verify available_history_minutes for selected timeframes]")
    
    tolerance_checks = [
        (5, 5),    # M=5, tolerance=±5
        (60, 5),   # M=60, tolerance=±5
        (375, 10)  # M=375, tolerance=±10
    ]
    
    for M, tolerance in tolerance_checks:
        avail = available_history.get(M)
        print(f"\n  [minutes={M}]")
        print(f"    available_history_minutes: {avail}")
        print(f"    expected: {M} ± {tolerance}")
        
        assert avail is not None, f"Expected available_history_minutes for M={M}, got None"
        
        diff = abs(avail - M)
        print(f"    difference: {diff:.2f} minutes")
        
        assert diff <= tolerance, \
            f"Expected available_history_minutes within ±{tolerance} of {M}, got {avail} (diff={diff:.2f})"
        print(f"    ✅ Within tolerance: {avail} is within ±{tolerance} of {M}")
    
    print("\n" + "="*80)
    print("TASK 2 SUMMARY")
    print("="*80)
    print(f"✅ All 6 timeframes tested: {timeframes}")
    print(f"✅ All responses: HTTP 200 OK")
    print(f"✅ All responses: current is not null")
    print(f"✅ All responses: previous is not null")
    print(f"✅ All responses: history_ready == true")
    print(f"✅ All 6 previous timestamps are DIFFERENT:")
    for M, ts in prev_ts.items():
        print(f"   - minutes={M}: {ts}")
    print(f"✅ available_history_minutes within tolerance:")
    for M, tolerance in tolerance_checks:
        avail = available_history[M]
        print(f"   - minutes={M}: {avail} (expected {M} ± {tolerance})")
    print("✅ TASK 2 PASSED: All assertions passed")
    
    return {
        "prev_ts": prev_ts,
        "available_history": available_history
    }


def main():
    """Run both tasks"""
    print("\n" + "="*80)
    print("BACKEND REGRESSION TEST — ROUND 9")
    print("DB REFRESH (FRESH PULL) EXHAUSTIVE VERIFICATION")
    print("="*80)
    print(f"Backend URL: {BASE_URL}")
    print(f"Admin credentials: {ADMIN_USERNAME} / {'*' * len(ADMIN_PASSWORD)}")
    print(f"Constraint: ≤5 login attempts")
    print("="*80)
    
    results = {}
    
    try:
        # TASK 1: POST /api/admin/refresh-day
        results["task1"] = test_task1_refresh_day_endpoint()
        
        # TASK 2: Timeframe distinctness after Fresh Pull
        results["task2"] = test_task2_timeframe_distinctness()
        
        # Final summary
        print("\n" + "="*80)
        print("FINAL SUMMARY — ALL TASKS")
        print("="*80)
        
        print(f"\n✅ TASK 1: POST /api/admin/refresh-day — PASSED")
        task1 = results["task1"]
        print(f"   - deleted: {task1['deleted']}")
        print(f"   - backfilled_snapshots: {task1['backfilled_snapshots']}")
        print(f"   - per_index_count: {task1['per_index_count']}")
        print(f"   - mode: {task1['mode']}")
        print(f"   - indices_backfilled: {task1['indices_backfilled']}")
        print(f"   - message contains 'Fresh Pull': YES")
        print(f"   - History verification:")
        for r in task1["history_results"]:
            print(f"     • {r['index']}: {r['count']} snapshots")
        
        print(f"\n✅ TASK 2: Timeframe distinctness — PASSED")
        task2 = results["task2"]
        print(f"   - All 6 timeframes tested: [5, 10, 15, 30, 60, 375]")
        print(f"   - All 6 previous timestamps are DIFFERENT")
        print(f"   - available_history_minutes within tolerance for [5, 60, 375]")
        
        print(f"\n" + "="*80)
        print(f"LOGIN ATTEMPTS USED: {login_attempts}/5")
        print("="*80)
        print("\n🎉 ALL TASKS PASSED — DB REFRESH WORKING CORRECTLY 🎉\n")
        
        return 0
        
    except AssertionError as e:
        print(f"\n❌ ASSERTION FAILED: {e}")
        print(f"\nLOGIN ATTEMPTS USED: {login_attempts}/5")
        return 1
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        print(f"\nLOGIN ATTEMPTS USED: {login_attempts}/5")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())
