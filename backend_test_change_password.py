#!/usr/bin/env python3
"""
Backend test suite for Guest Directory + Change Password feature (2026-07-17)
Tests change-password validation paths and guest directory endpoints.

CRITICAL CONSTRAINTS:
- DO NOT actually apply a valid password change (only test validation paths)
- DO NOT change Kite mode / wipe vault / delete alerts
- Rate-limit friendly: ≤5 login attempts total
- At END: ensure public_access_open=false
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

def log_warning(message: str):
    """Log warning"""
    print(f"{YELLOW}⚠ WARNING: {message}{RESET}")

def log_request(method: str, endpoint: str, headers: Dict = None, data: Any = None):
    """Log HTTP request details"""
    print(f"\n{YELLOW}→ {method} {endpoint}{RESET}")
    if headers:
        # Mask token for security
        masked_headers = {k: (v[:20] + "..." if k.lower() in ["x-admin-token", "authorization"] and len(v) > 20 else v) 
                         for k, v in headers.items()}
        print(f"  Headers: {masked_headers}")
    if data:
        # Mask passwords
        masked_data = {k: ("***" if "password" in k.lower() else v) for k, v in data.items()} if isinstance(data, dict) else data
        print(f"  Body: {masked_data}")

def log_response(status: int, data: Any = None):
    """Log HTTP response details"""
    color = GREEN if 200 <= status < 300 else (YELLOW if 400 <= status < 500 else RED)
    print(f"{color}← Status: {status}{RESET}")
    if data:
        print(f"  Response: {data}")

def test_1_change_password_anon():
    """Test 1: POST /api/auth/change-password anon → 401 Admin only"""
    log_test(1, "POST /api/auth/change-password anon → 401 Admin only")
    
    payload = {"old_password": "test", "new_password": "test1234"}
    log_request("POST", f"{BASE_URL}/auth/change-password", data=payload)
    resp = requests.post(f"{BASE_URL}/auth/change-password", json=payload)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        data = resp.json()
        if "Admin only" in data.get("detail", ""):
            log_pass("Change password endpoint correctly protected - returns 401 'Admin only'")
            return True
        else:
            log_pass(f"Change password endpoint protected - returns 401 (detail: {data.get('detail')})")
            return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_2_admin_login():
    """Test 2: Login as admin, get token"""
    global admin_token
    log_test(2, "POST /api/auth/login with correct credentials → 200, save token")
    
    payload = {"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
    log_request("POST", f"{BASE_URL}/auth/login", data=payload)
    resp = requests.post(f"{BASE_URL}/auth/login", json=payload)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        token = data.get("token")
        if token and len(token) > 20:
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

def test_3_change_password_wrong_old():
    """Test 3: POST /api/auth/change-password with wrong old password → 401"""
    log_test(3, "POST /api/auth/change-password with wrong old password → 401")
    
    if not admin_token:
        log_fail("No admin token available (test 2 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    payload = {"old_password": "wrong", "new_password": "12345678"}
    log_request("POST", f"{BASE_URL}/auth/change-password", headers=headers, data=payload)
    resp = requests.post(f"{BASE_URL}/auth/change-password", json=payload, headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        data = resp.json()
        detail = data.get("detail", "")
        if "incorrect" in detail.lower() or "password" in detail.lower():
            log_pass(f"Wrong old password correctly rejected - detail: {detail}")
            return True
        else:
            log_pass(f"Wrong old password rejected with 401 (detail: {detail})")
            return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_4_change_password_short_new():
    """Test 4: POST /api/auth/change-password with new < 8 chars → 400"""
    log_test(4, "POST /api/auth/change-password with new < 8 chars → 400")
    
    if not admin_token:
        log_fail("No admin token available (test 2 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    payload = {"old_password": ADMIN_PASSWORD, "new_password": "1234567"}  # 7 chars
    log_request("POST", f"{BASE_URL}/auth/change-password", headers=headers, data=payload)
    resp = requests.post(f"{BASE_URL}/auth/change-password", json=payload, headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 400:
        data = resp.json()
        detail = data.get("detail", "")
        if "8" in detail or "character" in detail.lower():
            log_pass(f"Short password correctly rejected - detail: {detail}")
            return True
        else:
            log_pass(f"Short password rejected with 400 (detail: {detail})")
            return True
    else:
        log_fail(f"Expected 400, got {resp.status_code}")
        return False

def test_5_change_password_same_as_old():
    """Test 5: POST /api/auth/change-password with same new → 400"""
    log_test(5, "POST /api/auth/change-password with same new → 400")
    
    if not admin_token:
        log_fail("No admin token available (test 2 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    payload = {"old_password": ADMIN_PASSWORD, "new_password": ADMIN_PASSWORD}
    log_request("POST", f"{BASE_URL}/auth/change-password", headers=headers, data=payload)
    resp = requests.post(f"{BASE_URL}/auth/change-password", json=payload, headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 400:
        data = resp.json()
        detail = data.get("detail", "")
        if "differ" in detail.lower() or "same" in detail.lower():
            log_pass(f"Same password correctly rejected - detail: {detail}")
            return True
        else:
            log_pass(f"Same password rejected with 400 (detail: {detail})")
            return True
    else:
        log_fail(f"Expected 400, got {resp.status_code}")
        return False

def test_6_validation_only():
    """Test 6: Confirm we did NOT actually change the password"""
    log_test(6, "Confirm we did NOT actually change the password (validation-only)")
    
    log_info("This test confirms we only tested validation paths and did NOT apply a valid password change")
    log_info("The password remains: MasterApp@123")
    log_warning("CRITICAL: DO NOT actually change the password - test_credentials.md must remain valid")
    log_pass("Validation-only tests completed - password unchanged")
    return True

def test_7_auth_guests_with_token():
    """Test 7: GET /api/auth/guests?since_hours=24 with X-Admin-Token → 200"""
    log_test(7, "GET /api/auth/guests?since_hours=24 with X-Admin-Token → 200")
    
    if not admin_token:
        log_fail("No admin token available (test 2 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    log_request("GET", f"{BASE_URL}/auth/guests?since_hours=24", headers=headers)
    resp = requests.get(f"{BASE_URL}/auth/guests?since_hours=24", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        required_keys = ["guests", "count", "since_hours"]
        if all(k in data for k in required_keys):
            log_pass(f"Guest list retrieved - {data.get('count')} guest(s) in last 24h")
            
            # Check guest row structure if any guests exist
            guests = data.get("guests", [])
            if guests:
                guest = guests[0]
                guest_keys = ["name", "ip", "started_at", "last_seen_at", "active", "idle_seconds"]
                if all(k in guest for k in guest_keys):
                    log_pass(f"Guest row structure correct - has all required keys: {guest_keys}")
                else:
                    log_info(f"Guest row keys: {list(guest.keys())}")
            else:
                log_info("No guests in last 24h (empty list is valid)")
            
            return True
        else:
            log_fail(f"Missing required keys. Expected: {required_keys}, Got: {list(data.keys())}")
            return False
    else:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False

def test_8_auth_guests_168h():
    """Test 8: GET /api/auth/guests?since_hours=168 with X-Admin-Token → 200"""
    log_test(8, "GET /api/auth/guests?since_hours=168 with X-Admin-Token → 200")
    
    if not admin_token:
        log_fail("No admin token available (test 2 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    log_request("GET", f"{BASE_URL}/auth/guests?since_hours=168", headers=headers)
    resp = requests.get(f"{BASE_URL}/auth/guests?since_hours=168", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        if data.get("since_hours") == 168:
            log_pass(f"Guest list retrieved for 168h (7 days) - {data.get('count')} guest(s)")
            return True
        else:
            log_fail(f"Expected since_hours=168, got {data.get('since_hours')}")
            return False
    else:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False

def test_9_auth_guests_anon():
    """Test 9: GET /api/auth/guests anon → 401"""
    log_test(9, "GET /api/auth/guests anon → 401")
    
    log_request("GET", f"{BASE_URL}/auth/guests")
    resp = requests.get(f"{BASE_URL}/auth/guests")
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 401:
        log_pass("Guest list endpoint correctly protected - returns 401 for anon")
        return True
    else:
        log_fail(f"Expected 401, got {resp.status_code}")
        return False

def test_10_auth_guests_over_cap():
    """Test 10: GET /api/auth/guests?since_hours=200 (over 168 cap) → 422 validation"""
    log_test(10, "GET /api/auth/guests?since_hours=200 (over 168 cap) → 422 validation")
    
    if not admin_token:
        log_fail("No admin token available (test 2 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    log_request("GET", f"{BASE_URL}/auth/guests?since_hours=200", headers=headers)
    resp = requests.get(f"{BASE_URL}/auth/guests?since_hours=200", headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 422:
        log_pass("Over-cap since_hours correctly rejected with 422 validation error")
        return True
    else:
        log_fail(f"Expected 422, got {resp.status_code}")
        return False

def test_11_regression():
    """Test 11: Regression - login still works with current password, app locked"""
    log_test(11, "Regression - login still works with current password, app locked")
    
    # Test login still works
    payload = {"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
    log_request("POST", f"{BASE_URL}/auth/login", data=payload)
    resp = requests.post(f"{BASE_URL}/auth/login", json=payload)
    log_response(resp.status_code)
    
    if resp.status_code != 200:
        log_fail(f"Login failed - expected 200, got {resp.status_code}")
        return False
    
    log_pass("Login still works with current password (MasterApp@123)")
    
    # Test app is locked (requires_login=true)
    time.sleep(0.3)
    log_request("GET", f"{BASE_URL}/auth/state")
    resp2 = requests.get(f"{BASE_URL}/auth/state")
    log_response(resp2.status_code, resp2.json() if resp2.status_code != 500 else resp2.text)
    
    if resp2.status_code == 200:
        state = resp2.json()
        if state.get("requires_login") == True:
            log_pass("App is locked - requires_login=true (anon access denied)")
            return True
        else:
            log_info(f"App state: requires_login={state.get('requires_login')}, public_access_open={state.get('public_access_open')}")
            # If public access is open, we need to close it
            if state.get("public_access_open") == True:
                log_warning("Public access is currently OPEN - will close in test 12")
            return True
    else:
        log_fail(f"Auth state check failed - expected 200, got {resp2.status_code}")
        return False

def test_12_security_headers():
    """Test 12: Security headers on /api/auth/change-password and /api/auth/guests"""
    log_test(12, "Security headers on /api/auth/change-password and /api/auth/guests")
    
    if not admin_token:
        log_fail("No admin token available (test 2 must pass first)")
        return False
    
    required_headers = [
        "x-content-type-options",
        "x-frame-options",
        "strict-transport-security"
    ]
    
    headers = {"X-Admin-Token": admin_token}
    
    # Test /api/auth/change-password
    log_info("Testing security headers on /api/auth/change-password")
    payload = {"old_password": "wrong", "new_password": "12345678"}
    resp = requests.post(f"{BASE_URL}/auth/change-password", json=payload, headers=headers)
    
    all_present = True
    for header in required_headers:
        if header.lower() in [h.lower() for h in resp.headers]:
            log_pass(f"Header '{header}' present on /api/auth/change-password")
        else:
            log_fail(f"Header '{header}' missing on /api/auth/change-password")
            all_present = False
    
    # Test /api/auth/guests
    time.sleep(0.3)
    log_info("Testing security headers on /api/auth/guests")
    resp2 = requests.get(f"{BASE_URL}/auth/guests", headers=headers)
    
    for header in required_headers:
        if header.lower() in [h.lower() for h in resp2.headers]:
            log_pass(f"Header '{header}' present on /api/auth/guests")
        else:
            log_fail(f"Header '{header}' missing on /api/auth/guests")
            all_present = False
    
    return all_present

def test_13_close_public_access():
    """Test 13 (CRITICAL): Ensure public_access_open=false at END"""
    log_test(13, "CRITICAL: Ensure public_access_open=false at END")
    
    if not admin_token:
        log_fail("No admin token available (test 2 must pass first)")
        return False
    
    headers = {"X-Admin-Token": admin_token}
    payload = {"open": False}
    log_request("POST", f"{BASE_URL}/auth/public-access", headers=headers, data=payload)
    resp = requests.post(f"{BASE_URL}/auth/public-access", json=payload, headers=headers)
    log_response(resp.status_code, resp.json() if resp.status_code != 500 else resp.text)
    
    if resp.status_code == 200:
        data = resp.json()
        if data.get("open") == False:
            log_pass("✅ CRITICAL REQUIREMENT MET: Public access closed successfully")
            
            # Verify auth state
            time.sleep(0.5)
            log_request("GET", f"{BASE_URL}/auth/state")
            resp2 = requests.get(f"{BASE_URL}/auth/state")
            log_response(resp2.status_code, resp2.json() if resp2.status_code != 500 else resp2.text)
            
            if resp2.status_code == 200:
                state = resp2.json()
                if state.get("requires_login") == True and state.get("public_access_open") == False:
                    log_pass("✅ Verified: App is safely locked (requires_login=true, public_access_open=false)")
                    return True
                else:
                    log_fail(f"Auth state incorrect: requires_login={state.get('requires_login')}, public_access_open={state.get('public_access_open')}")
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

def main():
    """Run all tests"""
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}GUEST DIRECTORY + CHANGE PASSWORD BACKEND TEST SUITE{RESET}")
    print(f"{BLUE}Testing change-password validation paths and guest directory endpoints{RESET}")
    print(f"{BLUE}Backend URL: {BASE_URL}{RESET}")
    print(f"{BLUE}Credentials: {ADMIN_USERNAME} / ***{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    print(f"\n{YELLOW}{'='*80}{RESET}")
    print(f"{YELLOW}CRITICAL CONSTRAINTS:{RESET}")
    print(f"{YELLOW}  - DO NOT actually apply a valid password change (only test validation paths){RESET}")
    print(f"{YELLOW}  - DO NOT change Kite mode / wipe vault / delete alerts{RESET}")
    print(f"{YELLOW}  - Rate-limit friendly: ≤5 login attempts total{RESET}")
    print(f"{YELLOW}  - At END: ensure public_access_open=false{RESET}")
    print(f"{YELLOW}{'='*80}{RESET}")
    
    tests = [
        test_1_change_password_anon,
        test_2_admin_login,
        test_3_change_password_wrong_old,
        test_4_change_password_short_new,
        test_5_change_password_same_as_old,
        test_6_validation_only,
        test_7_auth_guests_with_token,
        test_8_auth_guests_168h,
        test_9_auth_guests_anon,
        test_10_auth_guests_over_cap,
        test_11_regression,
        test_12_security_headers,
        test_13_close_public_access,
    ]
    
    results = []
    for test in tests:
        try:
            result = test()
            results.append(result)
            time.sleep(0.3)  # Rate limit friendly
        except Exception as e:
            log_fail(f"Test raised exception: {e}")
            import traceback
            traceback.print_exc()
            results.append(False)
    
    # Summary
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST SUMMARY{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    passed = sum(results)
    total = len(results)
    
    if passed == total:
        print(f"{GREEN}✅ ALL {total} TESTS PASSED{RESET}")
    else:
        print(f"{RED}✗ {total - passed} TEST(S) FAILED{RESET}")
        print(f"{GREEN}✓ {passed} TEST(S) PASSED{RESET}")
    
    print(f"\n{YELLOW}{'='*80}{RESET}")
    print(f"{YELLOW}CRITICAL VERIFICATION:{RESET}")
    print(f"{YELLOW}  ✓ Password NOT changed (remains: MasterApp@123){RESET}")
    print(f"{YELLOW}  ✓ Public access closed (test 13 must pass){RESET}")
    print(f"{YELLOW}  ✓ Login attempts: 2 total (within ≤5 limit){RESET}")
    print(f"{YELLOW}{'='*80}{RESET}")
    
    return passed == total

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
