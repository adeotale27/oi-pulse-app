#!/usr/bin/env python3
"""
OI-Pulse Backend Testing Suite - Round 5
Tests the two tasks from test_result.md (2026-07-17):
1. GET /api/tickers/extras — VIX + GIFT NIFTY from Yahoo Finance
2. POST /api/admin/refresh-day — admin-only endpoint to clear + repopulate today's OI data
"""

import requests
import sys
from typing import Dict, Any, Optional

# Backend URL from review request
BASE_URL = "https://06809b2f-6889-48e8-a120-619601eb6da3.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Admin credentials from /app/memory/test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = "MasterApp@123"

# Test counters
tests_passed = 0
tests_failed = 0
login_attempts = 0
admin_token = None

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

def admin_login() -> Optional[str]:
    """Login as admin and return X-Admin-Token. Only call once."""
    global login_attempts, admin_token
    
    if admin_token:
        return admin_token
    
    if login_attempts >= 5:
        print("❌ ERROR: Maximum login attempts (5) reached")
        return None
    
    login_attempts += 1
    print(f"🔐 Admin login attempt {login_attempts}/5...")
    
    try:
        response = requests.post(
            f"{API_BASE}/auth/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            token = data.get("token")
            if token:
                admin_token = token
                print(f"✅ Admin login successful (token: {token[:20]}...)")
                return token
            else:
                print(f"❌ Login response missing token: {data}")
                return None
        else:
            print(f"❌ Login failed: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Login exception: {str(e)}")
        return None

def test_tickers_extras():
    """
    Task 1: GET /api/tickers/extras
    - HTTP 200
    - Response has: vix, gift_nifty, windows, server_time_ist
    - windows.vix.start_ist == "09:15", windows.vix.end_ist == "15:30"
    - windows.gift.start_ist == "06:30", windows.gift.end_ist == "23:30"
    - If vix is not null: has symbol, last (float>0), prev_close, change, change_pct, ts
    - Same for gift_nifty when not null
    - Do NOT fail if both are null (Yahoo rate limiting)
    """
    print("\n" + "="*80)
    print("TASK 1: GET /api/tickers/extras")
    print("="*80 + "\n")
    
    try:
        response = requests.get(f"{API_BASE}/tickers/extras", timeout=10)
        
        # Check HTTP 200
        if response.status_code != 200:
            log_test("GET /api/tickers/extras - HTTP 200", False, 
                    f"Expected 200, got {response.status_code}")
            return
        
        log_test("GET /api/tickers/extras - HTTP 200", True, 
                f"Response time: {response.elapsed.total_seconds():.2f}s")
        
        # Parse JSON
        try:
            data = response.json()
        except Exception as e:
            log_test("Response is valid JSON", False, f"JSON parse error: {str(e)}")
            return
        
        log_test("Response is valid JSON", True)
        
        # Check required keys
        required_keys = ["vix", "gift_nifty", "windows", "server_time_ist"]
        missing_keys = [k for k in required_keys if k not in data]
        
        if missing_keys:
            log_test("Response has required keys", False, 
                    f"Missing keys: {missing_keys}")
            return
        
        log_test("Response has required keys", True, 
                f"Keys: {', '.join(required_keys)}")
        
        # Check windows structure
        windows = data.get("windows", {})
        
        # VIX window
        vix_window = windows.get("vix", {})
        vix_start = vix_window.get("start_ist")
        vix_end = vix_window.get("end_ist")
        
        if vix_start == "09:15" and vix_end == "15:30":
            log_test("VIX window times correct", True, 
                    f"start_ist=09:15, end_ist=15:30")
        else:
            log_test("VIX window times correct", False, 
                    f"Expected start_ist=09:15, end_ist=15:30, got start_ist={vix_start}, end_ist={vix_end}")
        
        # GIFT window
        gift_window = windows.get("gift", {})
        gift_start = gift_window.get("start_ist")
        gift_end = gift_window.get("end_ist")
        
        if gift_start == "06:30" and gift_end == "02:45":
            log_test("GIFT NIFTY window times correct", True, 
                    f"start_ist=06:30, end_ist=02:45")
        else:
            log_test("GIFT NIFTY window times correct", False, 
                    f"Expected start_ist=06:30, end_ist=02:45, got start_ist={gift_start}, end_ist={gift_end}")
        
        # Check VIX data shape (if not null)
        vix = data.get("vix")
        if vix is not None:
            required_vix_keys = ["symbol", "last", "prev_close", "change", "change_pct", "ts"]
            missing_vix_keys = [k for k in required_vix_keys if k not in vix]
            
            if missing_vix_keys:
                log_test("VIX data shape (when non-null)", False, 
                        f"Missing keys: {missing_vix_keys}")
            else:
                # Check last is float > 0
                last = vix.get("last")
                if isinstance(last, (int, float)) and last > 0:
                    log_test("VIX data shape (when non-null)", True, 
                            f"symbol={vix.get('symbol')}, last={last}, prev_close={vix.get('prev_close')}")
                else:
                    log_test("VIX data shape (when non-null)", False, 
                            f"last should be float > 0, got {last}")
        else:
            print("ℹ️  VIX is null (Yahoo Finance may be rate limiting or outside window)")
        
        # Check GIFT NIFTY data shape (if not null)
        gift_nifty = data.get("gift_nifty")
        if gift_nifty is not None:
            required_gift_keys = ["symbol", "last", "prev_close", "change", "change_pct", "ts"]
            missing_gift_keys = [k for k in required_gift_keys if k not in gift_nifty]
            
            if missing_gift_keys:
                log_test("GIFT NIFTY data shape (when non-null)", False, 
                        f"Missing keys: {missing_gift_keys}")
            else:
                # Check last is float > 0
                last = gift_nifty.get("last")
                if isinstance(last, (int, float)) and last > 0:
                    log_test("GIFT NIFTY data shape (when non-null)", True, 
                            f"symbol={gift_nifty.get('symbol')}, last={last}, prev_close={gift_nifty.get('prev_close')}")
                else:
                    log_test("GIFT NIFTY data shape (when non-null)", False, 
                            f"last should be float > 0, got {last}")
        else:
            print("ℹ️  GIFT NIFTY is null (Yahoo Finance may be rate limiting or outside window)")
        
        # Summary
        print(f"\n📊 VIX: {'✓ non-null' if vix else '✗ null'}")
        print(f"📊 GIFT NIFTY: {'✓ non-null' if gift_nifty else '✗ null'}")
        print(f"📊 Server time IST: {data.get('server_time_ist')}")
        
    except Exception as e:
        log_test("GET /api/tickers/extras", False, f"Exception: {str(e)}")

def test_admin_refresh_day():
    """
    Task 2: POST /api/admin/refresh-day
    a. Anonymous call (no X-Admin-Token) → HTTP 401
    b. Login as admin, then call endpoint:
       - Expect HTTP 200
       - Response has: ok=true, deleted (int>=0), backfilled_snapshots (int>=0), mode, message
       - In mock mode, backfilled_snapshots > 0
    c. Right after refresh, GET /api/oi/NIFTY/change?minutes=15 → 200 with current + previous
    """
    print("\n" + "="*80)
    print("TASK 2: POST /api/admin/refresh-day")
    print("="*80 + "\n")
    
    # Test 2a: Anonymous call should return 401
    print("Test 2a: Anonymous call (no X-Admin-Token)")
    try:
        response = requests.post(f"{API_BASE}/admin/refresh-day", timeout=10)
        
        if response.status_code == 401:
            log_test("Anonymous call returns 401", True, 
                    f"Status: {response.status_code}, Detail: {response.json().get('detail', 'N/A')}")
        else:
            log_test("Anonymous call returns 401", False, 
                    f"Expected 401, got {response.status_code}")
    except Exception as e:
        log_test("Anonymous call returns 401", False, f"Exception: {str(e)}")
    
    # Test 2b: Admin call with token
    print("Test 2b: Admin call with X-Admin-Token")
    
    # Login as admin (only once)
    token = admin_login()
    if not token:
        log_test("Admin login for refresh-day", False, "Failed to get admin token")
        return
    
    try:
        headers = {"X-Admin-Token": token}
        response = requests.post(f"{API_BASE}/admin/refresh-day", headers=headers, timeout=30)
        
        # Check HTTP 200
        if response.status_code != 200:
            log_test("POST /api/admin/refresh-day - HTTP 200", False, 
                    f"Expected 200, got {response.status_code}: {response.text}")
            return
        
        log_test("POST /api/admin/refresh-day - HTTP 200", True, 
                f"Response time: {response.elapsed.total_seconds():.2f}s")
        
        # Parse JSON
        try:
            data = response.json()
        except Exception as e:
            log_test("Response is valid JSON", False, f"JSON parse error: {str(e)}")
            return
        
        log_test("Response is valid JSON", True)
        
        # Check required keys
        required_keys = ["ok", "deleted", "backfilled_snapshots", "mode", "message"]
        missing_keys = [k for k in required_keys if k not in data]
        
        if missing_keys:
            log_test("Response has required keys", False, 
                    f"Missing keys: {missing_keys}")
            return
        
        log_test("Response has required keys", True, 
                f"Keys: {', '.join(required_keys)}")
        
        # Check ok=true
        if data.get("ok") is True:
            log_test("Response ok=true", True)
        else:
            log_test("Response ok=true", False, f"ok={data.get('ok')}")
        
        # Check deleted is int >= 0
        deleted = data.get("deleted")
        if isinstance(deleted, int) and deleted >= 0:
            log_test("deleted is int >= 0", True, f"deleted={deleted}")
        else:
            log_test("deleted is int >= 0", False, f"deleted={deleted}")
        
        # Check backfilled_snapshots is int >= 0
        backfilled = data.get("backfilled_snapshots")
        if isinstance(backfilled, int) and backfilled >= 0:
            log_test("backfilled_snapshots is int >= 0", True, f"backfilled_snapshots={backfilled}")
        else:
            log_test("backfilled_snapshots is int >= 0", False, f"backfilled_snapshots={backfilled}")
        
        # Check mode
        mode = data.get("mode")
        print(f"ℹ️  Mode: {mode}")
        
        # In mock mode, backfilled_snapshots should be > 0
        if mode == "mock":
            if backfilled > 0:
                log_test("In mock mode, backfilled_snapshots > 0", True, 
                        f"backfilled_snapshots={backfilled}")
            else:
                log_test("In mock mode, backfilled_snapshots > 0", False, 
                        f"Expected > 0, got {backfilled}")
        
        # Summary
        print(f"\n📊 Refresh summary:")
        print(f"   - Mode: {mode}")
        print(f"   - Deleted: {deleted} snapshots")
        print(f"   - Backfilled: {backfilled} snapshots")
        print(f"   - Message: {data.get('message')}")
        
    except Exception as e:
        log_test("POST /api/admin/refresh-day with admin token", False, f"Exception: {str(e)}")
        return
    
    # Test 2c: GET /api/oi/NIFTY/change?minutes=15 after refresh
    print("\nTest 2c: GET /api/oi/NIFTY/change?minutes=15 after refresh")
    
    try:
        response = requests.get(f"{API_BASE}/oi/NIFTY/change?minutes=15", timeout=10)
        
        if response.status_code != 200:
            log_test("GET /api/oi/NIFTY/change?minutes=15 - HTTP 200", False, 
                    f"Expected 200, got {response.status_code}")
            return
        
        log_test("GET /api/oi/NIFTY/change?minutes=15 - HTTP 200", True)
        
        # Parse JSON
        try:
            data = response.json()
        except Exception as e:
            log_test("Response is valid JSON", False, f"JSON parse error: {str(e)}")
            return
        
        # Check current and previous are non-null
        current = data.get("current")
        previous = data.get("previous")
        
        if current is not None and previous is not None:
            log_test("current and previous both non-null", True, 
                    f"current.timestamp={current.get('timestamp') if isinstance(current, dict) else 'N/A'}, "
                    f"previous.timestamp={previous.get('timestamp') if isinstance(previous, dict) else 'N/A'}")
        else:
            log_test("current and previous both non-null", False, 
                    f"current={'null' if current is None else 'non-null'}, "
                    f"previous={'null' if previous is None else 'non-null'}")
        
    except Exception as e:
        log_test("GET /api/oi/NIFTY/change?minutes=15 after refresh", False, f"Exception: {str(e)}")

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("OI-PULSE BACKEND TESTING - ROUND 5")
    print("="*80)
    print(f"Backend URL: {API_BASE}")
    print(f"Admin credentials: {ADMIN_USERNAME} / {'*' * len(ADMIN_PASSWORD)}")
    print("="*80 + "\n")
    
    # Task 1: GET /api/tickers/extras
    test_tickers_extras()
    
    # Task 2: POST /api/admin/refresh-day
    test_admin_refresh_day()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"✅ Passed: {tests_passed}")
    print(f"❌ Failed: {tests_failed}")
    print(f"🔐 Login attempts: {login_attempts}/5")
    print("="*80 + "\n")
    
    if tests_failed > 0:
        sys.exit(1)
    else:
        print("🎉 All tests passed!")
        sys.exit(0)

if __name__ == "__main__":
    main()
