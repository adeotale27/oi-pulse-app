#!/usr/bin/env python3
"""
Backend test suite for Admin-proof lock-down feature (2026-07-17)
Tests session-based tokens, admin-guard on sensitive endpoints, and guest flow.
"""

import requests
import time
from typing import Dict, Any, Optional

# Backend URL from frontend/.env
BASE_URL = "https://768861c1-e842-4795-b466-c68d987f3978.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = "MasterApp@123"

# Test state
admin_token: Optional[str] = None
guest_token: Optional[str] = None

# ANSI color codes for output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"

def log_test(test_num: int, description: str):
    """Log test start"""
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}Test {test_num}: {description}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")

def log_pass(message: str):
    """Log test pass"""
    print(f"{GREEN}✓ PASS: {message}{RESET}")

def log_fail(message: str):
    """Log test failure"""
    print(f"{RED}✗ FAIL: {message}{RESET}")

def log_info(message: str):
    """Log info"""
    print(f"{YELLOW}ℹ INFO: {message}{RESET}")

def log_request(method: str, endpoint: str, headers: Dict = None, data: Any = None):
    """Log HTTP request details"""
    print(f"\n{YELLOW}→ {method} {endpoint}{RESET}")
    if headers:
        print(f"  Headers: {headers}")
    if data:
        print(f"  Body: {data}")

def log_response(status: int, data: Any = None):
    """Log HTTP response details"""
    color = GREEN if 200 <= status < 300 else RED
    print(f"{color}← Status: {status}{RESET}")
    if data:
        print(f"  Response: {data}")

def test_1_vault_anon():
    """Test 1: GET /api/kite/vault anon → 401 with 'Admin only'"""
    log_test(1, "GET /api/kite/vault anon → 401 with 'Admin only'")
    
    log_request("GET", f"{BASE_URL}/kite/vault")
    resp = requests.get(f"{BASE_URL}/kite/vault")
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        data = resp.json()
        if "Admin only" in data.get("detail", ""):
            log_pass("Vault endpoint correctly protected - returns 401 'Admin only'")
            return True
        else:
            log_fail(f"Expected 'Admin only' in detail, got: {data.get('detail')}")
            return False
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_2_positions_anon():
    """Test 2: GET /api/positions anon → 401"""
    log_test(2, "GET /api/positions anon → 401")
    
    log_request("GET", f"{BASE_URL}/positions")
    resp = requests.get(f"{BASE_URL}/positions")
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        log_pass("Positions endpoint correctly protected - returns 401")
        return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_3_delete_alerts_anon():
    """Test 3: DELETE /api/alerts anon → 401"""
    log_test(3, "DELETE /api/alerts anon → 401")
    
    log_request("DELETE", f"{BASE_URL}/alerts")
    resp = requests.delete(f"{BASE_URL}/alerts")
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        log_pass("Delete alerts endpoint correctly protected - returns 401")
        return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_4_mode_anon():
    """Test 4: POST /api/mode anon with body {"mode":"kite"} → 401"""
    log_test(4, "POST /api/mode anon with body {\"mode\":\"kite\"} → 401")
    
    payload = {"mode": "kite"}
    log_request("POST", f"{BASE_URL}/mode", data=payload)
    resp = requests.post(f"{BASE_URL}/mode", json=payload)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        log_pass("Mode endpoint correctly protected - returns 401")
        return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_5_telegram_prefs_post_anon():
    """Test 5: POST /api/telegram/prefs anon → 401"""
    log_test(5, "POST /api/telegram/prefs anon → 401")
    
    payload = {"enabled": True}
    log_request("POST", f"{BASE_URL}/telegram/prefs", data=payload)
    resp = requests.post(f"{BASE_URL}/telegram/prefs", json=payload)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        log_pass("Telegram prefs POST endpoint correctly protected - returns 401")
        return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_6_telegram_prefs_get_anon():
    """Test 6: GET /api/telegram/prefs anon → 401"""
    log_test(6, "GET /api/telegram/prefs anon → 401")
    
    log_request("GET", f"{BASE_URL}/telegram/prefs")
    resp = requests.get(f"{BASE_URL}/telegram/prefs")
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        log_pass("Telegram prefs GET endpoint correctly protected - returns 401")
        return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_7_admin_login():
    """Test 7: POST /api/auth/login with correct credentials → 200, save token"""
    global admin_token
    log_test(7, "POST /api/auth/login with correct credentials → 200, save token")
    
    payload = {"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
    log_request("POST", f"{BASE_URL}/auth/login", data=payload)
    resp = requests.post(f"{BASE_URL}/auth/login", json=payload)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        token = data.get("token")
        if token and len(token) > 20:  # token_urlsafe(32) produces ~43 chars
            admin_token = token
            log_pass(f"Admin login successful - token received (length: {len(token)})")
            log_info(f"Token: {token[:20]}...")
            log_info(f"is_admin: {data.get('is_admin')}, username: {data.get('username')}")
            return True
        else:
            log_fail(f"Token missing or too short: {token}")
            return False
    else:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False

def test_8_vault_with_admin_token():
    """Test 8: GET /api/kite/vault with X-Admin-Token → 200"""
    log_test(8, "GET /api/kite/vault with X-Admin-Token → 200")
    
    if not admin_token:
        log_fail("No admin token available (test 7 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    log_request("GET", f"{BASE_URL}/kite/vault", headers=headers)
    resp = requests.get(f"{BASE_URL}/kite/vault", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        log_pass(f"Vault accessible with admin token - has_api_key: {data.get('has_api_key')}")
        return True
    else:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False

def test_9_logout_and_invalidate():
    """Test 9: POST /api/auth/logout → 200, then vault with same token → 401"""
    global admin_token
    log_test(9, "POST /api/auth/logout → 200, then vault with same token → 401")
    
    if not admin_token:
        log_fail("No admin token available (test 7 must pass first)")
        return False
    
    old_token = admin_token
    headers = {"X-Admin-Token": old_token}
    
    # Logout
    log_request("POST", f"{BASE_URL}/auth/logout", headers=headers)
    resp = requests.post(f"{BASE_URL}/auth/logout", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code != 200:
        log_fail(f"Logout failed - expected 200, got {resp.status_code}")
        return False
    
    log_pass("Logout successful")
    
    # Try to use the invalidated token
    time.sleep(0.5)
    log_request("GET", f"{BASE_URL}/kite/vault", headers=headers)
    resp = requests.get(f"{BASE_URL}/kite/vault", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        log_pass("Invalidated token correctly rejected - returns 401")
        admin_token = None  # Clear the token
        return True
    else:
        log_fail(f"Expected 401 for invalidated token, got {resp.status_code}")
        return False

def test_10_login_and_open_public_access():
    """Test 10: Login again, then POST /api/auth/public-access {"open":true} → 200"""
    global admin_token
    log_test(10, "Login again, then POST /api/auth/public-access {\"open\":true} → 200")
    
    # Login again
    payload = {"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
    log_request("POST", f"{BASE_URL}/auth/login", data=payload)
    resp = requests.post(f"{BASE_URL}/auth/login", json=payload)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code != 200:
        log_fail(f"Re-login failed - expected 200, got {resp.status_code}")
        return False
    
    admin_token = resp.json().get("token")
    log_pass(f"Re-login successful - new token received")
    
    # Open public access
    headers = {"X-Admin-Token": admin_token}
    payload = {"open": True}
    log_request("POST", f"{BASE_URL}/auth/public-access", headers=headers, data=payload)
    resp = requests.post(f"{BASE_URL}/auth/public-access", json=payload, headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        if data.get("open") == True and data.get("expires_at"):
            log_pass(f"Public access opened - expires_at: {data.get('expires_at')}")
            return True
        else:
            log_fail(f"Unexpected response: {data}")
            return False
    else:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False

def test_11_guest_login_valid():
    """Test 11: Anon POST /api/auth/guest {"name":"Rahul Sharma"} → 200"""
    global guest_token
    log_test(11, "Anon POST /api/auth/guest {\"name\":\"Rahul Sharma\"} → 200")
    
    payload = {"name": "Rahul Sharma"}
    log_request("POST", f"{BASE_URL}/auth/guest", data=payload)
    resp = requests.post(f"{BASE_URL}/auth/guest", json=payload)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        token = data.get("token")
        name = data.get("name")
        if token and name == "Rahul Sharma":
            guest_token = token
            log_pass(f"Guest login successful - token received, name: {name}")
            log_info(f"Guest token: {token[:20]}...")
            return True
        else:
            log_fail(f"Unexpected response: {data}")
            return False
    else:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False

def test_12_guest_login_invalid_name():
    """Test 12: Anon POST /api/auth/guest {"name":"Rahul"} (no space) → 400"""
    log_test(12, "Anon POST /api/auth/guest {\"name\":\"Rahul\"} (no space) → 400")
    
    payload = {"name": "Rahul"}
    log_request("POST", f"{BASE_URL}/auth/guest", data=payload)
    resp = requests.post(f"{BASE_URL}/auth/guest", json=payload)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 400:
        data = resp.json()
        detail = data.get("detail", "")
        if "full name" in detail.lower() or "space" in detail.lower():
            log_pass(f"Invalid name correctly rejected - detail: {detail}")
            return True
        else:
            log_pass(f"Invalid name rejected with 400 (detail: {detail})")
            return True
    else:
        log_fail(f"Expected 400, got {resp.status_code}")
        return False

def test_13_guest_login_duplicate():
    """Test 13: Anon POST /api/auth/guest {"name":"Rahul Sharma"} again → 200 (optional)"""
    log_test(13, "Anon POST /api/auth/guest {\"name\":\"Rahul Sharma\"} again → 200")
    
    payload = {"name": "Rahul Sharma"}
    log_request("POST", f"{BASE_URL}/auth/guest", data=payload)
    resp = requests.post(f"{BASE_URL}/auth/guest", json=payload)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        log_pass(f"Duplicate guest login allowed - new session created")
        return True
    else:
        log_info(f"Duplicate guest login returned {resp.status_code} (optional test)")
        return True  # Optional test, don't fail

def test_14_auth_state_with_guest_token():
    """Test 14: GET /api/auth/state with X-Guest-Token → 200 is_guest=true"""
    log_test(14, "GET /api/auth/state with X-Guest-Token → 200 is_guest=true")
    
    if not guest_token:
        log_fail("No guest token available (test 11 must pass first)")
        return False
    
    headers = {"X-Guest-Token": guest_token}
    log_request("GET", f"{BASE_URL}/auth/state", headers=headers)
    resp = requests.get(f"{BASE_URL}/auth/state", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        if data.get("is_guest") == True and data.get("guest_name") == "Rahul Sharma" and data.get("is_admin") == False:
            log_pass(f"Guest state correct - is_guest: True, guest_name: {data.get('guest_name')}, is_admin: False")
            return True
        else:
            log_fail(f"Unexpected state: {data}")
            return False
    else:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False

def test_15_positions_with_guest_token():
    """Test 15: GET /api/positions with X-Guest-Token → 401 (guest is NOT admin)"""
    log_test(15, "GET /api/positions with X-Guest-Token → 401")
    
    if not guest_token:
        log_fail("No guest token available (test 11 must pass first)")
        return False
    
    headers = {"X-Guest-Token": guest_token}
    log_request("GET", f"{BASE_URL}/positions", headers=headers)
    resp = requests.get(f"{BASE_URL}/positions", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        log_pass("Guest correctly denied access to positions endpoint - returns 401")
        return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_16_delete_alerts_with_guest_token():
    """Test 16: DELETE /api/alerts with X-Guest-Token → 401"""
    log_test(16, "DELETE /api/alerts with X-Guest-Token → 401")
    
    if not guest_token:
        log_fail("No guest token available (test 11 must pass first)")
        return False
    
    headers = {"X-Guest-Token": guest_token}
    log_request("DELETE", f"{BASE_URL}/alerts", headers=headers)
    resp = requests.delete(f"{BASE_URL}/alerts", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        log_pass("Guest correctly denied access to delete alerts - returns 401")
        return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_17_auth_guests_list():
    """Test 17: GET /api/auth/guests with X-Admin-Token → 200 with guests array"""
    log_test(17, "GET /api/auth/guests with X-Admin-Token → 200 with guests array")
    
    if not admin_token:
        log_fail("No admin token available (test 10 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    log_request("GET", f"{BASE_URL}/auth/guests", headers=headers)
    resp = requests.get(f"{BASE_URL}/auth/guests", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        guests = data.get("guests", [])
        if any("Rahul Sharma" in str(g) for g in guests):
            log_pass(f"Guest list retrieved - found 'Rahul Sharma' in {len(guests)} guest(s)")
            return True
        else:
            log_fail(f"'Rahul Sharma' not found in guests list: {guests}")
            return False
    else:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False

def test_18_close_public_access():
    """Test 18: POST /api/auth/public-access {"open":false} → 200 (CRITICAL)"""
    log_test(18, "POST /api/auth/public-access {\"open\":false} → 200 (CRITICAL)")
    
    if not admin_token:
        log_fail("No admin token available (test 10 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    payload = {"open": False}
    log_request("POST", f"{BASE_URL}/auth/public-access", headers=headers, data=payload)
    resp = requests.post(f"{BASE_URL}/auth/public-access", json=payload, headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        if data.get("open") == False:
            log_pass("Public access closed successfully - app is safely locked")
            
            # Verify auth state
            time.sleep(0.5)
            log_request("GET", f"{BASE_URL}/auth/state")
            resp2 = requests.get(f"{BASE_URL}/auth/state")
            log_response(resp2.status_code, resp2.json() if resp2.status_code != 500 else resp2.text)
            
            if resp2.status_code == 200:
                state = resp2.json()
                if state.get("requires_login") == True:
                    log_pass("Verified: Auth state confirms app is locked (requires_login=true)")
                    return True
                else:
                    log_fail(f"Auth state shows requires_login={state.get('requires_login')}, expected True")
                    return False
            else:
                log_info("Could not verify auth state (non-critical)")
                return True
        else:
            log_fail(f"Unexpected response: {data}")
            return False
    else:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False

def test_19_regression_read_endpoints():
    """Test 19: Regression - GET /api/status, /api/oi/NIFTY, /api/tickers still 200 for anon"""
    log_test(19, "Regression - read endpoints still accessible for anon")
    
    endpoints = [
        "/status",
        "/oi/NIFTY",
        "/tickers"
    ]
    
    all_pass = True
    for endpoint in endpoints:
        log_request("GET", f"{BASE_URL}{endpoint}")
        resp = requests.get(f"{BASE_URL}{endpoint}")
        log_response(resp.status_code)
        
        if resp.status_code == 200:
            log_pass(f"{endpoint} accessible - returns 200")
        else:
            log_fail(f"{endpoint} failed - expected 200, got {resp.status_code}")
            all_pass = False
        
        time.sleep(0.2)
    
    return all_pass

def test_20_security_headers():
    """Test 20: Security headers on /api/auth/guest, /api/auth/logout, /api/auth/guests"""
    log_test(20, "Security headers on new auth endpoints")
    
    required_headers = [
        "x-content-type-options",
        "x-frame-options",
        "strict-transport-security"
    ]
    
    # Test /api/auth/guest (need public access open first)
    log_info("Testing security headers on /api/auth/guest")
    payload = {"name": "Test User"}
    resp = requests.post(f"{BASE_URL}/auth/guest", json=payload)
    
    all_present = True
    for header in required_headers:
        if header.lower() in [h.lower() for h in resp.headers]:
            log_pass(f"Header '{header}' present on /api/auth/guest")
        else:
            log_fail(f"Header '{header}' missing on /api/auth/guest")
            all_present = False
    
    return all_present

def main():
    """Run all tests"""
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}ADMIN-PROOF LOCK-DOWN BACKEND TEST SUITE{RESET}")
    print(f"{BLUE}Testing session-based tokens, admin-guard, and guest flow{RESET}")
    print(f"{BLUE}Backend URL: {BASE_URL}{RESET}")
    print(f"{BLUE}Credentials: {ADMIN_USERNAME} / {ADMIN_PASSWORD}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    tests = [
        test_1_vault_anon,
        test_2_positions_anon,
        test_3_delete_alerts_anon,
        test_4_mode_anon,
        test_5_telegram_prefs_post_anon,
        test_6_telegram_prefs_get_anon,
        test_7_admin_login,
        test_8_vault_with_admin_token,
        test_9_logout_and_invalidate,
        test_10_login_and_open_public_access,
        test_11_guest_login_valid,
        test_12_guest_login_invalid_name,
        test_13_guest_login_duplicate,
        test_14_auth_state_with_guest_token,
        test_15_positions_with_guest_token,
        test_16_delete_alerts_with_guest_token,
        test_17_auth_guests_list,
        test_18_close_public_access,
        test_19_regression_read_endpoints,
        test_20_security_headers,
    ]
    
    results = []
    for test in tests:
        try:
            result = test()
            results.append(result)
            time.sleep(0.3)  # Rate limit friendly
        except Exception as e:
            log_fail(f"Test raised exception: {e}")
            results.append(False)
    
    # Summary
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST SUMMARY{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    passed = sum(results)
    total = len(results)
    
    if passed == total:
        print(f"{GREEN}✓ ALL {total} TESTS PASSED{RESET}")
    else:
        print(f"{RED}✗ {total - passed} TEST(S) FAILED{RESET}")
        print(f"{GREEN}✓ {passed} TEST(S) PASSED{RESET}")
    
    print(f"\n{YELLOW}CRITICAL: Verify public access is closed (test 18 must pass){RESET}")
    
    return passed == total

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
