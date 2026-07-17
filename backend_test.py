#!/usr/bin/env python3
"""
Backend regression test — round 7
Three tasks: Expiry weekdays, GIFT NIFTY updates, Fresh Pull all indices
"""

import requests
import time
from datetime import datetime, date

# Backend URL from review request
BASE_URL = "https://06809b2f-6889-48e8-a120-619601eb6da3.preview.emergentagent.com/api"

# Admin credentials from /app/memory/test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = "MasterApp@123"

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


def test_task1_expiry_weekdays():
    """
    TASK 1 — Expiry weekdays
    - GET /api/expiries/NIFTY → 200. Parse every date in response.expiries with datetime.date.fromisoformat. 
      Assert `d.weekday() == 1` for ALL 6 dates (Tuesday).
    - GET /api/expiries/BANKNIFTY → same assertion (weekday == 1, Tuesday).
    - GET /api/expiries/SENSEX → 200. Assert `d.weekday() == 3` for ALL 6 dates (Thursday).
    - For each of the 3, assert `len(expiries) == 6` and at least one item in `expiries_meta` has tag=="M" and one has tag=="W".
    """
    print("\n" + "="*80)
    print("TASK 1 — EXPIRY WEEKDAYS")
    print("="*80)
    
    test_cases = [
        ("NIFTY", 1, "Tuesday"),
        ("BANKNIFTY", 1, "Tuesday"),
        ("SENSEX", 3, "Thursday")
    ]
    
    results = []
    
    for index, expected_weekday, weekday_name in test_cases:
        print(f"\n[Testing {index}]")
        
        resp = requests.get(f"{BASE_URL}/expiries/{index}", timeout=10)
        print(f"  Status: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        data = resp.json()
        expiries = data.get("expiries", [])
        expiries_meta = data.get("expiries_meta", [])
        
        print(f"  Expiries count: {len(expiries)}")
        assert len(expiries) == 6, f"Expected 6 expiries, got {len(expiries)}"
        
        # Parse dates and check weekday
        dates = []
        for exp_str in expiries:
            d = date.fromisoformat(exp_str)
            dates.append(d)
            weekday = d.weekday()
            print(f"    {exp_str} → weekday={weekday} ({d.strftime('%A')})")
            assert weekday == expected_weekday, \
                f"Expected weekday {expected_weekday} ({weekday_name}), got {weekday} for {exp_str}"
        
        # Check expiries_meta has at least one M and one W tag
        tags = [item.get("tag") for item in expiries_meta]
        has_m = "M" in tags
        has_w = "W" in tags
        print(f"  Tags in expiries_meta: {tags}")
        print(f"  Has M tag: {has_m}, Has W tag: {has_w}")
        assert has_m, f"Expected at least one 'M' tag in expiries_meta for {index}"
        assert has_w, f"Expected at least one 'W' tag in expiries_meta for {index}"
        
        results.append({
            "index": index,
            "expected_weekday": weekday_name,
            "dates": [str(d) for d in dates],
            "all_correct": True
        })
        print(f"  ✅ {index}: All 6 dates are {weekday_name}s, has M and W tags")
    
    print("\n" + "="*80)
    print("TASK 1 SUMMARY")
    print("="*80)
    for r in results:
        print(f"✅ {r['index']}: All 6 expiries are {r['expected_weekday']}s")
    print("✅ TASK 1 PASSED: All expiry weekday assertions passed")
    
    return results


def test_task2_gift_nifty():
    """
    TASK 2 — GIFT NIFTY updates via yfinance
    - GET /api/tickers/extras. If `response.gift_nifty` is null, sleep 15s and retry. 
      Do this up to 4 times (total wait ≤ 60s).
    - After the loop, assert `response.gift_nifty is not None` and `response.gift_nifty.last` is a float > 0. 
      Also assert `response.gift_nifty.symbol == "^NSEI"`.
    - Just report the vix status (may be null since IST is likely past 15:30).
    """
    print("\n" + "="*80)
    print("TASK 2 — GIFT NIFTY UPDATES VIA YFINANCE")
    print("="*80)
    
    max_retries = 4
    retry_delay = 15
    
    gift_nifty = None
    vix = None
    
    for attempt in range(1, max_retries + 1):
        print(f"\n[Attempt {attempt}/{max_retries}]")
        
        resp = requests.get(f"{BASE_URL}/tickers/extras", timeout=10)
        print(f"  Status: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        data = resp.json()
        gift_nifty = data.get("gift_nifty")
        vix = data.get("vix")
        
        print(f"  gift_nifty: {gift_nifty}")
        print(f"  vix: {vix}")
        
        if gift_nifty is not None:
            print(f"  ✅ gift_nifty is not null on attempt {attempt}")
            break
        
        if attempt < max_retries:
            print(f"  ⏳ gift_nifty is null, sleeping {retry_delay}s before retry...")
            time.sleep(retry_delay)
    
    # Assertions after retry loop
    print("\n[Final Assertions]")
    assert gift_nifty is not None, "gift_nifty is still null after 4 retries (60s wait)"
    print(f"  ✅ gift_nifty is not None")
    
    last_value = gift_nifty.get("last")
    symbol = gift_nifty.get("symbol")
    
    print(f"  gift_nifty.last: {last_value} (type: {type(last_value).__name__})")
    print(f"  gift_nifty.symbol: {symbol}")
    
    assert isinstance(last_value, (int, float)), f"Expected last to be numeric, got {type(last_value)}"
    assert last_value > 0, f"Expected last > 0, got {last_value}"
    print(f"  ✅ gift_nifty.last is a float > 0: {last_value}")
    
    assert symbol == "^NSEI", f"Expected symbol '^NSEI', got '{symbol}'"
    print(f"  ✅ gift_nifty.symbol == '^NSEI'")
    
    # Report VIX status (may be null)
    print(f"\n[VIX Status Report]")
    if vix is not None:
        print(f"  VIX data available: {vix}")
    else:
        print(f"  VIX is null (expected if IST is past 15:30)")
    
    print("\n" + "="*80)
    print("TASK 2 SUMMARY")
    print("="*80)
    print(f"✅ GIFT NIFTY: last={last_value}, symbol={symbol}")
    print(f"ℹ️  VIX: {'Available' if vix else 'null (expected after market hours)'}")
    print("✅ TASK 2 PASSED: GIFT NIFTY updates working correctly")
    
    return {"gift_nifty": gift_nifty, "vix": vix}


def test_task3_fresh_pull_all_indices():
    """
    TASK 3 — Fresh Pull covers all 3 indices
    - Log in as admin (one login).
    - POST /api/admin/refresh-day (with X-Admin-Token) → 200.
    - Assert response.ok == true and response.indices_backfilled == ["NIFTY","SENSEX","BANKNIFTY"].
    - Assert response.backfilled_snapshots > 0.
    - For each idx in ["NIFTY", "SENSEX", "BANKNIFTY"]:
      - GET /api/history/{idx}?minutes=1440 → 200 with response.count > 0.
    """
    print("\n" + "="*80)
    print("TASK 3 — FRESH PULL COVERS ALL 3 INDICES")
    print("="*80)
    
    # Login as admin (ONE login only)
    print("\n[Step 1: Admin Login]")
    admin_token = login_admin()
    
    # POST /api/admin/refresh-day
    print("\n[Step 2: POST /api/admin/refresh-day]")
    headers = {"X-Admin-Token": admin_token}
    
    resp = requests.post(f"{BASE_URL}/admin/refresh-day", headers=headers, timeout=30)
    print(f"  Status: {resp.status_code}")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    
    data = resp.json()
    print(f"  Response: {data}")
    
    # Assert response.ok == true
    ok = data.get("ok")
    print(f"  ok: {ok}")
    assert ok is True, f"Expected ok=true, got {ok}"
    print(f"  ✅ response.ok == true")
    
    # Assert response.indices_backfilled == ["NIFTY","SENSEX","BANKNIFTY"]
    indices_backfilled = data.get("indices_backfilled", [])
    print(f"  indices_backfilled: {indices_backfilled}")
    expected_indices = ["NIFTY", "SENSEX", "BANKNIFTY"]
    # Sort both lists for comparison (order may vary)
    assert sorted(indices_backfilled) == sorted(expected_indices), \
        f"Expected {expected_indices}, got {indices_backfilled}"
    print(f"  ✅ response.indices_backfilled == {expected_indices}")
    
    # Assert response.backfilled_snapshots > 0
    backfilled_snapshots = data.get("backfilled_snapshots", 0)
    print(f"  backfilled_snapshots: {backfilled_snapshots}")
    assert backfilled_snapshots > 0, f"Expected backfilled_snapshots > 0, got {backfilled_snapshots}"
    print(f"  ✅ response.backfilled_snapshots > 0: {backfilled_snapshots}")
    
    # For each index, verify history has data
    print("\n[Step 3: Verify history for each index]")
    history_results = []
    
    for idx in ["NIFTY", "SENSEX", "BANKNIFTY"]:
        print(f"\n  [Testing {idx}]")
        resp = requests.get(f"{BASE_URL}/history/{idx}?minutes=1440", timeout=10)
        print(f"    Status: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200 for {idx}, got {resp.status_code}"
        
        data = resp.json()
        count = data.get("count", 0)
        print(f"    count: {count}")
        assert count > 0, f"Expected count > 0 for {idx}, got {count}"
        print(f"    ✅ {idx}: history count > 0 ({count} snapshots)")
        
        history_results.append({"index": idx, "count": count})
    
    print("\n" + "="*80)
    print("TASK 3 SUMMARY")
    print("="*80)
    print(f"✅ Admin login successful (1 login used)")
    print(f"✅ POST /api/admin/refresh-day: ok=true")
    print(f"✅ indices_backfilled: {expected_indices}")
    print(f"✅ backfilled_snapshots: {backfilled_snapshots}")
    for r in history_results:
        print(f"✅ {r['index']}: history count = {r['count']}")
    print("✅ TASK 3 PASSED: Fresh Pull covers all 3 indices")
    
    return {
        "backfilled_snapshots": backfilled_snapshots,
        "indices_backfilled": indices_backfilled,
        "history_results": history_results
    }


def main():
    """Run all three tasks"""
    print("\n" + "="*80)
    print("BACKEND REGRESSION TEST — ROUND 7")
    print("="*80)
    print(f"Backend URL: {BASE_URL}")
    print(f"Admin credentials: {ADMIN_USERNAME} / {'*' * len(ADMIN_PASSWORD)}")
    print(f"Constraint: ≤5 login attempts")
    print("="*80)
    
    results = {}
    
    try:
        # TASK 1: Expiry weekdays
        results["task1"] = test_task1_expiry_weekdays()
        
        # TASK 2: GIFT NIFTY updates
        results["task2"] = test_task2_gift_nifty()
        
        # TASK 3: Fresh Pull all indices
        results["task3"] = test_task3_fresh_pull_all_indices()
        
        # Final summary
        print("\n" + "="*80)
        print("FINAL SUMMARY — ALL TASKS")
        print("="*80)
        print(f"✅ TASK 1: Expiry weekdays — PASSED")
        print(f"   - NIFTY: 6 Tuesdays")
        print(f"   - BANKNIFTY: 6 Tuesdays")
        print(f"   - SENSEX: 6 Thursdays")
        print(f"   - All have M and W tags")
        
        print(f"\n✅ TASK 2: GIFT NIFTY updates — PASSED")
        gift_nifty = results["task2"]["gift_nifty"]
        print(f"   - gift_nifty.last: {gift_nifty.get('last')}")
        print(f"   - gift_nifty.symbol: {gift_nifty.get('symbol')}")
        
        print(f"\n✅ TASK 3: Fresh Pull all indices — PASSED")
        task3 = results["task3"]
        print(f"   - indices_backfilled: {task3['indices_backfilled']}")
        print(f"   - backfilled_snapshots: {task3['backfilled_snapshots']}")
        for r in task3["history_results"]:
            print(f"   - {r['index']}: {r['count']} snapshots")
        
        print(f"\n" + "="*80)
        print(f"LOGIN ATTEMPTS USED: {login_attempts}/5")
        print("="*80)
        print("\n🎉 ALL 3 TASKS PASSED 🎉\n")
        
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
