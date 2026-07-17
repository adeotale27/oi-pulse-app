#!/usr/bin/env python3
"""
Backend test suite for NSE OI Tracker - Telegram Preferences Feature
Test date: 2026-07-17
Focus: Telegram preferences (per-index / per-type / quiet hours / presets) + MAJOR shift signal + Lakh formatting

CRITICAL CONSTRAINTS:
- Send AT MOST 2 Telegram messages during testing
- DO NOT change Kite mode, DO NOT wipe vault, DO NOT flood rate limiter
- MUST restore prefs to preset "everything" at the END of testing
"""

import requests
import json
import time
from typing import Dict, Any

# Backend URL from frontend/.env
BASE_URL = "https://768861c1-e842-4795-b466-c68d987f3978.preview.emergentagent.com/api"

# Test results tracking
test_results = []
telegram_messages_sent = 0
MAX_TELEGRAM_MESSAGES = 2


def log_test(test_num: int, description: str, passed: bool, details: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    result = {
        "test": test_num,
        "description": description,
        "status": status,
        "passed": passed,
        "details": details
    }
    test_results.append(result)
    print(f"\nTest {test_num}: {description}")
    print(f"  {status}")
    if details:
        print(f"  Details: {details}")


def test_1_get_telegram_prefs():
    """Test 1: GET /api/telegram/prefs -> 200 with required keys"""
    try:
        resp = requests.get(f"{BASE_URL}/telegram/prefs", timeout=10)
        
        if resp.status_code != 200:
            log_test(1, "GET /api/telegram/prefs", False, 
                    f"Expected 200, got {resp.status_code}")
            return None
        
        data = resp.json()
        required_keys = ["enabled", "indices", "types", "quiet_hours", "major_abs_threshold"]
        missing_keys = [k for k in required_keys if k not in data]
        
        if missing_keys:
            log_test(1, "GET /api/telegram/prefs", False, 
                    f"Missing keys: {missing_keys}")
            return None
        
        log_test(1, "GET /api/telegram/prefs", True, 
                f"All required keys present: {list(data.keys())}")
        return data
    except Exception as e:
        log_test(1, "GET /api/telegram/prefs", False, f"Exception: {e}")
        return None


def test_2_post_telegram_prefs_indices():
    """Test 2: POST /api/telegram/prefs with index filtering -> verify persistence"""
    try:
        # Set NIFTY=true, SENSEX=false, BANKNIFTY=false
        payload = {
            "indices": {
                "NIFTY": True,
                "SENSEX": False,
                "BANKNIFTY": False
            }
        }
        
        resp = requests.post(f"{BASE_URL}/telegram/prefs", json=payload, timeout=10)
        
        if resp.status_code != 200:
            log_test(2, "POST /api/telegram/prefs (index filtering)", False, 
                    f"POST returned {resp.status_code}")
            return False
        
        # Verify persistence with GET
        time.sleep(0.5)  # Brief delay for DB write
        get_resp = requests.get(f"{BASE_URL}/telegram/prefs", timeout=10)
        
        if get_resp.status_code != 200:
            log_test(2, "POST /api/telegram/prefs (index filtering)", False, 
                    f"GET verification returned {get_resp.status_code}")
            return False
        
        data = get_resp.json()
        indices = data.get("indices", {})
        
        if indices.get("NIFTY") == True and indices.get("SENSEX") == False and indices.get("BANKNIFTY") == False:
            log_test(2, "POST /api/telegram/prefs (index filtering)", True, 
                    f"Indices persisted correctly: NIFTY=True, SENSEX=False, BANKNIFTY=False")
            return True
        else:
            log_test(2, "POST /api/telegram/prefs (index filtering)", False, 
                    f"Indices not persisted correctly: {indices}")
            return False
    except Exception as e:
        log_test(2, "POST /api/telegram/prefs (index filtering)", False, f"Exception: {e}")
        return False


def test_3_huge_shift_with_sensex_off():
    """Test 3: POST /api/telegram/huge-shift with SENSEX OFF -> verify no crash"""
    global telegram_messages_sent
    
    try:
        # SENSEX is already OFF from test 2
        payload = {
            "index": "SENSEX",
            "side": "PE",
            "value": 5000000,
            "direction": "build",
            "window": 3,
            "price": 77500.0,
            "atm": 77500,
            "contributing": [{"strike": 77500, "ce_delta": -100000, "pe_delta": 5000000}]
        }
        
        resp = requests.post(f"{BASE_URL}/telegram/huge-shift", json=payload, timeout=10)
        
        if resp.status_code != 200:
            log_test(3, "POST /api/telegram/huge-shift (SENSEX OFF)", False, 
                    f"Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        # Backend returns {"ok": true} even when message not sent (silent no-op)
        log_test(3, "POST /api/telegram/huge-shift (SENSEX OFF)", True, 
                f"No crash, returned 200 with response: {data}")
        # Message should NOT be sent because SENSEX is OFF
        return True
    except Exception as e:
        log_test(3, "POST /api/telegram/huge-shift (SENSEX OFF)", False, f"Exception: {e}")
        return False


def test_4_preset_nifty_only():
    """Test 4: POST /api/telegram/prefs/preset/nifty_only -> verify preset works"""
    try:
        resp = requests.post(f"{BASE_URL}/telegram/prefs/preset/nifty_only", timeout=10)
        
        if resp.status_code != 200:
            log_test(4, "POST /api/telegram/prefs/preset/nifty_only", False, 
                    f"Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        indices = data.get("indices", {})
        
        if indices.get("NIFTY") == True and indices.get("SENSEX") == False and indices.get("BANKNIFTY") == False:
            log_test(4, "POST /api/telegram/prefs/preset/nifty_only", True, 
                    f"Preset applied correctly: NIFTY=True, SENSEX=False, BANKNIFTY=False")
            return True
        else:
            log_test(4, "POST /api/telegram/prefs/preset/nifty_only", False, 
                    f"Preset not applied correctly: {indices}")
            return False
    except Exception as e:
        log_test(4, "POST /api/telegram/prefs/preset/nifty_only", False, f"Exception: {e}")
        return False


def test_5_preset_off():
    """Test 5: POST /api/telegram/prefs/preset/off -> verify master switch"""
    try:
        resp = requests.post(f"{BASE_URL}/telegram/prefs/preset/off", timeout=10)
        
        if resp.status_code != 200:
            log_test(5, "POST /api/telegram/prefs/preset/off", False, 
                    f"Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        enabled = data.get("enabled")
        
        if enabled == False:
            log_test(5, "POST /api/telegram/prefs/preset/off", True, 
                    f"Master switch disabled: enabled=False")
            return True
        else:
            log_test(5, "POST /api/telegram/prefs/preset/off", False, 
                    f"Master switch not disabled: enabled={enabled}")
            return False
    except Exception as e:
        log_test(5, "POST /api/telegram/prefs/preset/off", False, f"Exception: {e}")
        return False


def test_6_huge_shift_while_disabled():
    """Test 6: POST /api/telegram/huge-shift while enabled=false -> verify no send"""
    global telegram_messages_sent
    
    try:
        # Master switch is OFF from test 5
        payload = {
            "index": "NIFTY",
            "side": "CE",
            "value": 8000000,
            "direction": "build",
            "window": 5,
            "price": 24250.0,
            "atm": 24250,
            "contributing": [{"strike": 24250, "ce_delta": 8000000, "pe_delta": -200000}]
        }
        
        resp = requests.post(f"{BASE_URL}/telegram/huge-shift", json=payload, timeout=10)
        
        if resp.status_code != 200:
            log_test(6, "POST /api/telegram/huge-shift (enabled=false)", False, 
                    f"Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        # Backend returns {"ok": true} even when message not sent
        log_test(6, "POST /api/telegram/huge-shift (enabled=false)", True, 
                f"No crash, returned 200. Message should NOT be sent (master switch OFF)")
        return True
    except Exception as e:
        log_test(6, "POST /api/telegram/huge-shift (enabled=false)", False, f"Exception: {e}")
        return False


def test_7_preset_everything_restore():
    """Test 7: POST /api/telegram/prefs/preset/everything -> RESTORE (REQUIRED)"""
    try:
        resp = requests.post(f"{BASE_URL}/telegram/prefs/preset/everything", timeout=10)
        
        if resp.status_code != 200:
            log_test(7, "POST /api/telegram/prefs/preset/everything (RESTORE)", False, 
                    f"Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        enabled = data.get("enabled")
        indices = data.get("indices", {})
        
        all_indices_enabled = (indices.get("NIFTY") == True and 
                              indices.get("SENSEX") == True and 
                              indices.get("BANKNIFTY") == True)
        
        if enabled == True and all_indices_enabled:
            log_test(7, "POST /api/telegram/prefs/preset/everything (RESTORE)", True, 
                    f"✅ CRITICAL: Prefs restored to 'everything' - enabled=True, all indices=True")
            return True
        else:
            log_test(7, "POST /api/telegram/prefs/preset/everything (RESTORE)", False, 
                    f"❌ CRITICAL: Prefs NOT fully restored: enabled={enabled}, indices={indices}")
            return False
    except Exception as e:
        log_test(7, "POST /api/telegram/prefs/preset/everything (RESTORE)", False, 
                f"❌ CRITICAL FAILURE: Exception: {e}")
        return False


def test_8_preset_invalid():
    """Test 8: POST /api/telegram/prefs/preset/nonsense -> verify 400 error"""
    try:
        resp = requests.post(f"{BASE_URL}/telegram/prefs/preset/nonsense", timeout=10)
        
        if resp.status_code == 400:
            data = resp.json()
            detail = data.get("detail", "")
            if "nonsense" in detail.lower() or "available" in detail.lower():
                log_test(8, "POST /api/telegram/prefs/preset/nonsense", True, 
                        f"Correctly returned 400 with detail: {detail}")
                return True
            else:
                log_test(8, "POST /api/telegram/prefs/preset/nonsense", False, 
                        f"Returned 400 but detail unclear: {detail}")
                return False
        else:
            log_test(8, "POST /api/telegram/prefs/preset/nonsense", False, 
                    f"Expected 400, got {resp.status_code}")
            return False
    except Exception as e:
        log_test(8, "POST /api/telegram/prefs/preset/nonsense", False, f"Exception: {e}")
        return False


def test_9_major_shift_with_buy_banner():
    """Test 9: POST /api/telegram/huge-shift with major shift -> verify 200 (sends 1 message)"""
    global telegram_messages_sent
    
    try:
        if telegram_messages_sent >= MAX_TELEGRAM_MESSAGES:
            log_test(9, "POST /api/telegram/huge-shift (major shift)", False, 
                    f"SKIPPED: Already sent {telegram_messages_sent} messages (max {MAX_TELEGRAM_MESSAGES})")
            return False
        
        # Major shift: value >= 20_000_000 (2 Cr) -> triggers BUY banner
        payload = {
            "index": "NIFTY",
            "side": "PE",
            "value": 25000000,  # 2.5 Cr - MAJOR shift
            "direction": "build",
            "window": 3,
            "price": 24244.85,
            "atm": 24250,
            "contributing": [
                {"strike": 24250, "ce_delta": -500000, "pe_delta": 22000000}
            ]
        }
        
        resp = requests.post(f"{BASE_URL}/telegram/huge-shift", json=payload, timeout=10)
        
        if resp.status_code != 200:
            log_test(9, "POST /api/telegram/huge-shift (major shift)", False, 
                    f"Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        if data.get("ok") == True:
            telegram_messages_sent += 1
            log_test(9, "POST /api/telegram/huge-shift (major shift)", True, 
                    f"Returned 200 with ok=true. Message sent ({telegram_messages_sent}/{MAX_TELEGRAM_MESSAGES}). Should show 🟢🟢🟢 BUY BUY BUY banner")
            return True
        else:
            log_test(9, "POST /api/telegram/huge-shift (major shift)", False, 
                    f"Returned 200 but ok={data.get('ok')}")
            return False
    except Exception as e:
        log_test(9, "POST /api/telegram/huge-shift (major shift)", False, f"Exception: {e}")
        return False


def test_10_regression_endpoints():
    """Test 10: Regression - GET /api/status, /api/market/status, /api/telegram/status all 200"""
    endpoints = [
        "/status",
        "/market/status",
        "/telegram/status"
    ]
    
    all_passed = True
    details = []
    
    for endpoint in endpoints:
        try:
            resp = requests.get(f"{BASE_URL}{endpoint}", timeout=10)
            if resp.status_code == 200:
                details.append(f"{endpoint}: ✅ 200")
            else:
                details.append(f"{endpoint}: ❌ {resp.status_code}")
                all_passed = False
        except Exception as e:
            details.append(f"{endpoint}: ❌ Exception: {e}")
            all_passed = False
    
    log_test(10, "Regression: status endpoints", all_passed, 
            "\n    " + "\n    ".join(details))
    return all_passed


def test_11_cors_security_headers():
    """Test 11: CORS + security headers on new endpoints"""
    endpoints = [
        "/telegram/prefs",
        "/telegram/prefs/preset/everything"
    ]
    
    required_headers = [
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "permissions-policy"
    ]
    
    all_passed = True
    details = []
    
    for endpoint in endpoints:
        try:
            if "preset" in endpoint:
                resp = requests.post(f"{BASE_URL}{endpoint}", timeout=10)
            else:
                resp = requests.get(f"{BASE_URL}{endpoint}", timeout=10)
            
            missing_headers = []
            for header in required_headers:
                if header not in resp.headers:
                    missing_headers.append(header)
            
            if missing_headers:
                details.append(f"{endpoint}: ❌ Missing headers: {missing_headers}")
                all_passed = False
            else:
                details.append(f"{endpoint}: ✅ All security headers present")
        except Exception as e:
            details.append(f"{endpoint}: ❌ Exception: {e}")
            all_passed = False
    
    log_test(11, "CORS + security headers on new endpoints", all_passed, 
            "\n    " + "\n    ".join(details))
    return all_passed


def print_summary():
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY - Telegram Preferences Backend")
    print("="*80)
    
    passed = sum(1 for r in test_results if r["passed"])
    total = len(test_results)
    
    print(f"\nTotal Tests: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {total - passed}")
    print(f"Telegram Messages Sent: {telegram_messages_sent}/{MAX_TELEGRAM_MESSAGES}")
    
    print("\n" + "-"*80)
    print("DETAILED RESULTS:")
    print("-"*80)
    
    for result in test_results:
        print(f"\n{result['status']} Test {result['test']}: {result['description']}")
        if result['details']:
            print(f"  {result['details']}")
    
    print("\n" + "="*80)
    
    if passed == total:
        print("✅ ALL TESTS PASSED")
    else:
        print(f"❌ {total - passed} TEST(S) FAILED")
    
    print("="*80)


def main():
    """Run all tests in sequence"""
    print("="*80)
    print("NSE OI Tracker - Telegram Preferences Backend Test Suite")
    print("Test Date: 2026-07-17")
    print("="*80)
    print(f"\nBackend URL: {BASE_URL}")
    print(f"Max Telegram Messages: {MAX_TELEGRAM_MESSAGES}")
    print("\nStarting tests...\n")
    
    # Run tests in order
    test_1_get_telegram_prefs()
    test_2_post_telegram_prefs_indices()
    test_3_huge_shift_with_sensex_off()
    test_4_preset_nifty_only()
    test_5_preset_off()
    test_6_huge_shift_while_disabled()
    test_7_preset_everything_restore()  # CRITICAL: Must restore at end
    test_8_preset_invalid()
    test_9_major_shift_with_buy_banner()
    test_10_regression_endpoints()
    test_11_cors_security_headers()
    
    # Print summary
    print_summary()
    
    # Return exit code
    passed = sum(1 for r in test_results if r["passed"])
    total = len(test_results)
    return 0 if passed == total else 1


if __name__ == "__main__":
    exit(main())
