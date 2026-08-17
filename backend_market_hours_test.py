#!/usr/bin/env python3
"""
OI-Pulse Backend Market Hours Enforcement Testing Suite
Tests the three tasks from test_result.md (2026-07-17 2nd round):
1. GET /api/status returns market phase + banner text
2. Polling stops outside market window (no new snapshots when market closed)
3. OI endpoint stability when market is closed (no fresh Kite calls)
"""

import os
import requests
import sys
import time
from typing import Dict, Any

# Backend URL from review request
BASE_URL = "https://strike-preview-1.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Admin credentials from /app/memory/test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = (os.environ.get("ADMIN_PASSWORD") or "").strip()
if not ADMIN_PASSWORD:
    raise SystemExit("Set ADMIN_PASSWORD env var to run this test (do not hardcode secrets).")

# Test counters
tests_passed = 0
tests_failed = 0
login_attempts = 0

def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    global tests_passed, tests_failed
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  → {details}")
    if passed:
        tests_passed += 1
    else:
        tests_failed += 1
    print()

def test_status_market_fields():
    """
    TASK 1: GET /api/status returns market phase + banner text
    
    Assert response includes a `market` object with fields:
    - is_market_open (bool)
    - phase (string in {open, pre_open, post_close, weekend, holiday})
    - banner_title
    - banner_detail
    - display_open_ist == "09:15"
    - display_close_ist == "15:30"
    """
    test_name = "TASK 1: GET /api/status - market phase + banner text"
    
    try:
        response = requests.get(f"{API_BASE}/status", timeout=10)
        
        if response.status_code != 200:
            log_test(test_name, False, f"Expected 200, got {response.status_code}")
            return None
        
        data = response.json()
        
        # Check market object exists
        if "market" not in data:
            log_test(test_name, False, "Missing 'market' object in response")
            return None
        
        market = data["market"]
        
        # Check required fields
        required_fields = {
            "is_market_open": bool,
            "phase": str,
            "banner_title": str,
            "banner_detail": str,
            "display_open_ist": str,
            "display_close_ist": str
        }
        
        missing_fields = []
        wrong_types = []
        
        for field, expected_type in required_fields.items():
            if field not in market:
                missing_fields.append(field)
            elif not isinstance(market[field], expected_type):
                wrong_types.append(f"{field} (expected {expected_type.__name__}, got {type(market[field]).__name__})")
        
        if missing_fields:
            log_test(test_name, False, f"Missing fields: {missing_fields}")
            return None
        
        if wrong_types:
            log_test(test_name, False, f"Wrong types: {wrong_types}")
            return None
        
        # Check phase is valid
        valid_phases = {"open", "pre_open", "post_close", "weekend", "holiday"}
        if market["phase"] not in valid_phases:
            log_test(test_name, False, f"Invalid phase: {market['phase']} (expected one of {valid_phases})")
            return None
        
        # Check display times
        if market["display_open_ist"] != "09:15":
            log_test(test_name, False, f"display_open_ist should be '09:15', got '{market['display_open_ist']}'")
            return None
        
        if market["display_close_ist"] != "15:30":
            log_test(test_name, False, f"display_close_ist should be '15:30', got '{market['display_close_ist']}'")
            return None
        
        # Check banner fields are non-empty when phase != "open"
        if market["phase"] != "open":
            if not market["banner_title"]:
                log_test(test_name, False, f"banner_title is empty when phase={market['phase']}")
                return None
            if not market["banner_detail"]:
                log_test(test_name, False, f"banner_detail is empty when phase={market['phase']}")
                return None
        
        # All checks passed
        details = f"phase={market['phase']}, is_market_open={market['is_market_open']}, " \
                  f"banner_title='{market['banner_title'][:50]}...', " \
                  f"display_open_ist={market['display_open_ist']}, display_close_ist={market['display_close_ist']}"
        log_test(test_name, True, details)
        
        return market
        
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")
        return None

def test_polling_stops_outside_window(market_phase: str):
    """
    TASK 2: Polling stops outside market window
    
    Query GET /api/history/NIFTY?minutes=1440 → capture the count of docs returned.
    Sleep 20 seconds.
    Query GET /api/history/NIFTY?minutes=1440 again → capture new count.
    If the current /api/status phase is NOT "open", the counts MUST be equal (no new snapshots inserted).
    If phase IS "open" (unlikely in test env), the second count should be >= first count.
    """
    test_name = "TASK 2: Polling stops outside market window"
    
    try:
        # First query
        response1 = requests.get(f"{API_BASE}/history/NIFTY?minutes=1440", timeout=10)
        
        if response1.status_code != 200:
            log_test(test_name, False, f"First query failed: {response1.status_code}")
            return
        
        data1 = response1.json()
        count1 = len(data1.get("snapshots", []))
        
        print(f"  → First query: {count1} snapshots")
        
        # Sleep 20 seconds
        print(f"  → Sleeping 20 seconds...")
        time.sleep(20)
        
        # Second query
        response2 = requests.get(f"{API_BASE}/history/NIFTY?minutes=1440", timeout=10)
        
        if response2.status_code != 200:
            log_test(test_name, False, f"Second query failed: {response2.status_code}")
            return
        
        data2 = response2.json()
        count2 = len(data2.get("snapshots", []))
        
        print(f"  → Second query: {count2} snapshots")
        
        # Check based on market phase
        if market_phase != "open":
            # Market is closed - counts MUST be equal
            if count1 == count2:
                log_test(test_name, True, f"Counts equal ({count1} == {count2}) when phase={market_phase} - polling stopped correctly")
            else:
                log_test(test_name, False, f"Counts differ ({count1} vs {count2}) when phase={market_phase} - polling should have stopped!")
        else:
            # Market is open - second count should be >= first
            if count2 >= count1:
                log_test(test_name, True, f"Second count ({count2}) >= first count ({count1}) when phase=open")
            else:
                log_test(test_name, False, f"Second count ({count2}) < first count ({count1}) when phase=open - unexpected!")
        
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")

def test_oi_endpoint_stability(market_phase: str):
    """
    TASK 3: OI endpoint stability when market is closed
    
    Call GET /api/oi/NIFTY/change?minutes=15 → capture `current.timestamp` as T1.
    Sleep 5 seconds.
    Call GET /api/oi/NIFTY/change?minutes=15 → capture `current.timestamp` as T2.
    If phase != "open": T1 MUST equal T2 (proving no fresh Kite/mock call, serving from cache/DB only).
    Also assert the endpoint returned HTTP 200 both times.
    """
    test_name = "TASK 3: OI endpoint stability when market is closed"
    
    try:
        # First call
        response1 = requests.get(f"{API_BASE}/oi/NIFTY/change?minutes=15", timeout=10)
        
        if response1.status_code != 200:
            log_test(test_name, False, f"First call failed: {response1.status_code}")
            return
        
        data1 = response1.json()
        
        if "current" not in data1 or "timestamp" not in data1["current"]:
            log_test(test_name, False, "First call missing current.timestamp")
            return
        
        t1 = data1["current"]["timestamp"]
        print(f"  → First call: current.timestamp = {t1}")
        
        # Sleep 5 seconds
        print(f"  → Sleeping 5 seconds...")
        time.sleep(5)
        
        # Second call
        response2 = requests.get(f"{API_BASE}/oi/NIFTY/change?minutes=15", timeout=10)
        
        if response2.status_code != 200:
            log_test(test_name, False, f"Second call failed: {response2.status_code}")
            return
        
        data2 = response2.json()
        
        if "current" not in data2 or "timestamp" not in data2["current"]:
            log_test(test_name, False, "Second call missing current.timestamp")
            return
        
        t2 = data2["current"]["timestamp"]
        print(f"  → Second call: current.timestamp = {t2}")
        
        # Check based on market phase
        if market_phase != "open":
            # Market is closed - timestamps MUST be equal
            if t1 == t2:
                log_test(test_name, True, f"Timestamps equal when phase={market_phase} - no fresh fetch, serving from cache/DB")
            else:
                log_test(test_name, False, f"Timestamps differ when phase={market_phase} - fresh fetch occurred! T1={t1}, T2={t2}")
        else:
            # Market is open - timestamps may differ (fresh fetches allowed)
            if t2 >= t1:
                log_test(test_name, True, f"T2 >= T1 when phase=open (fresh fetches allowed)")
            else:
                log_test(test_name, False, f"T2 < T1 when phase=open - unexpected!")
        
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")

def main():
    """Run all tests"""
    print("=" * 80)
    print("OI-PULSE MARKET HOURS ENFORCEMENT TEST SUITE")
    print("=" * 80)
    print(f"Backend URL: {BASE_URL}")
    print(f"API Base: {API_BASE}")
    print("=" * 80)
    print()
    
    # ========================================
    # TASK 1: GET /api/status returns market phase + banner text
    # ========================================
    print("TASK 1: GET /api/status - market phase + banner text")
    print("-" * 80)
    
    market = test_status_market_fields()
    
    if not market:
        print("⚠️  Cannot proceed with remaining tests - /api/status failed")
        print()
        print("=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print(f"Total tests: {tests_passed + tests_failed}")
        print(f"✅ Passed: {tests_passed}")
        print(f"❌ Failed: {tests_failed}")
        print("=" * 80)
        sys.exit(1)
    
    market_phase = market["phase"]
    print(f"Current market phase: {market_phase}")
    print()
    
    # ========================================
    # TASK 2: Polling stops outside market window
    # ========================================
    print("TASK 2: Polling stops outside market window")
    print("-" * 80)
    
    test_polling_stops_outside_window(market_phase)
    
    # ========================================
    # TASK 3: OI endpoint stability when market is closed
    # ========================================
    print("TASK 3: OI endpoint stability when market is closed")
    print("-" * 80)
    
    test_oi_endpoint_stability(market_phase)
    
    # ========================================
    # SUMMARY
    # ========================================
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total tests: {tests_passed + tests_failed}")
    print(f"✅ Passed: {tests_passed}")
    print(f"❌ Failed: {tests_failed}")
    print(f"Login attempts used: {login_attempts}/5")
    print("=" * 80)
    
    if tests_failed > 0:
        print("\n⚠️  SOME TESTS FAILED")
        sys.exit(1)
    else:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)

if __name__ == "__main__":
    main()
