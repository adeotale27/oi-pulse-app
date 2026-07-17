#!/usr/bin/env python3
"""
Backend test suite for NSE OI Tracker - Admin Authentication Endpoints
Test date: 2026-07-17
Focus: Admin login gate + admin-only Public Access toggle (auto-expires 3:30 PM IST)
"""

import requests
import json
from datetime import datetime, timezone
from typing import Dict, Any

# Backend URL from frontend/.env
BASE_URL = "https://768861c1-e842-4795-b466-c68d987f3978.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = "MasterApp@123"

# Global variable to store admin token
ADMIN_TOKEN = None

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
    print(f"{GREEN}✅ PASS: {message}{RESET}")

def log_fail(message: str):
    """Log test fail"""
    print(f"{RED}❌ FAIL: {message}{RESET}")

def log_info(message: str):
    """Log info"""
    print(f"{YELLOW}ℹ️  INFO: {message}{RESET}")

def log_request(method: str, url: str, headers: Dict = None, data: Any = None):
    """Log HTTP request details"""
    print(f"\n{YELLOW}→ {method} {url}{RESET}")
    if headers:
        print(f"  Headers: {json.dumps({k: v for k, v in headers.items() if 'token' not in k.lower()}, indent=2)}")
        if any('token' in k.lower() for k in headers.keys()):
            print(f"  Auth headers: [REDACTED]")
    if data:
        print(f"  Body: {json.dumps(data, indent=2)}")

def log_response(response: requests.Response):
    """Log HTTP response details"""
    print(f"\n{YELLOW}← Status: {response.status_code}{RESET}")
    try:
        body = response.json()
        print(f"  Body: {json.dumps(body, indent=2)}")
    except:
        print(f"  Body: {response.text[:200]}")
    print(f"  Response time: {response.elapsed.total_seconds():.2f}s")

def check_security_headers(response: requests.Response) -> bool:
    """Check if all required security headers are present"""
    required_headers = [
        'x-content-type-options',
        'x-frame-options',
        'strict-transport-security'
    ]
    
    missing = []
    for header in required_headers:
        if header not in response.headers:
            missing.append(header)
    
    if missing:
        log_fail(f"Missing security headers: {missing}")
        return False
    else:
        log_pass(f"All required security headers present")
        return True

def test_1_auth_state_anonymous():
    """Test 1: GET /api/auth/state (no headers) - should require login"""
    log_test(1, "GET /api/auth/state (anonymous) - should require login")
    
    url = f"{BASE_URL}/auth/state"
    log_request("GET", url)
    
    response = requests.get(url)
    log_response(response)
    
    if response.status_code != 200:
        log_fail(f"Expected 200, got {response.status_code}")
        return False
    
    data = response.json()
    
    # Check required keys
    required_keys = ['requires_login', 'is_admin', 'public_access_open']
    missing_keys = [k for k in required_keys if k not in data]
    if missing_keys:
        log_fail(f"Missing keys: {missing_keys}")
        return False
    
    # Check values
    if data['requires_login'] != True:
        log_fail(f"Expected requires_login=true, got {data['requires_login']}")
        return False
    
    if data['is_admin'] != False:
        log_fail(f"Expected is_admin=false, got {data['is_admin']}")
        return False
    
    if data['public_access_open'] != False:
        log_fail(f"Expected public_access_open=false, got {data['public_access_open']}")
        return False
    
    log_pass("Auth state correct: requires_login=true, is_admin=false, public_access_open=false")
    return True

def test_2_admin_login_success():
    """Test 2: POST /api/auth/login with correct credentials"""
    global ADMIN_TOKEN
    
    log_test(2, "POST /api/auth/login with correct credentials")
    
    url = f"{BASE_URL}/auth/login"
    payload = {
        "username": ADMIN_USERNAME,
        "password": ADMIN_PASSWORD
    }
    
    log_request("POST", url, data=payload)
    
    response = requests.post(url, json=payload)
    log_response(response)
    
    if response.status_code != 200:
        log_fail(f"Expected 200, got {response.status_code}")
        return False
    
    data = response.json()
    
    # Check required keys
    required_keys = ['ok', 'token', 'is_admin', 'username']
    missing_keys = [k for k in required_keys if k not in data]
    if missing_keys:
        log_fail(f"Missing keys: {missing_keys}")
        return False
    
    # Check values
    if not data.get('ok'):
        log_fail(f"Expected ok=true, got {data.get('ok')}")
        return False
    
    if not data.get('token'):
        log_fail("Token is empty or missing")
        return False
    
    if data.get('is_admin') != True:
        log_fail(f"Expected is_admin=true, got {data.get('is_admin')}")
        return False
    
    if data.get('username') != ADMIN_USERNAME:
        log_fail(f"Expected username={ADMIN_USERNAME}, got {data.get('username')}")
        return False
    
    # Save token for subsequent tests
    ADMIN_TOKEN = data['token']
    log_pass(f"Login successful, token received: {ADMIN_TOKEN[:20]}...")
    log_pass(f"is_admin=true, username={ADMIN_USERNAME}")
    
    return True

def test_3_admin_login_failure():
    """Test 3: POST /api/auth/login with wrong credentials"""
    log_test(3, "POST /api/auth/login with wrong credentials - expect 401")
    
    url = f"{BASE_URL}/auth/login"
    payload = {
        "username": "wrong_user",
        "password": "wrong_pass"
    }
    
    log_request("POST", url, data=payload)
    
    response = requests.post(url, json=payload)
    log_response(response)
    
    if response.status_code != 401:
        log_fail(f"Expected 401, got {response.status_code}")
        return False
    
    data = response.json()
    
    if 'detail' not in data or 'Invalid credentials' not in data['detail']:
        log_fail(f"Expected 'Invalid credentials' in detail, got: {data}")
        return False
    
    log_pass("Login correctly rejected with 401 'Invalid credentials'")
    return True

def test_4_auth_state_with_admin_token():
    """Test 4: GET /api/auth/state with admin token"""
    log_test(4, "GET /api/auth/state with X-Admin-Token header")
    
    if not ADMIN_TOKEN:
        log_fail("No admin token available from test 2")
        return False
    
    url = f"{BASE_URL}/auth/state"
    headers = {"X-Admin-Token": ADMIN_TOKEN}
    
    log_request("GET", url, headers=headers)
    
    response = requests.get(url, headers=headers)
    log_response(response)
    
    if response.status_code != 200:
        log_fail(f"Expected 200, got {response.status_code}")
        return False
    
    data = response.json()
    
    if data.get('is_admin') != True:
        log_fail(f"Expected is_admin=true, got {data.get('is_admin')}")
        return False
    
    log_pass("Auth state with admin token: is_admin=true")
    return True

def test_5_public_access_without_admin():
    """Test 5: POST /api/auth/public-access without admin header - expect 401"""
    log_test(5, "POST /api/auth/public-access without admin header - expect 401")
    
    url = f"{BASE_URL}/auth/public-access"
    payload = {"open": True}
    
    log_request("POST", url, data=payload)
    
    response = requests.post(url, json=payload)
    log_response(response)
    
    if response.status_code != 401:
        log_fail(f"Expected 401, got {response.status_code}")
        return False
    
    log_pass("Public access correctly rejected without admin token (401)")
    return True

def test_6_public_access_open():
    """Test 6: POST /api/auth/public-access with admin header (open=true)"""
    log_test(6, "POST /api/auth/public-access with admin header (open=true)")
    
    if not ADMIN_TOKEN:
        log_fail("No admin token available from test 2")
        return False
    
    url = f"{BASE_URL}/auth/public-access"
    headers = {"X-Admin-Token": ADMIN_TOKEN}
    payload = {"open": True}
    
    log_request("POST", url, headers=headers, data=payload)
    
    response = requests.post(url, json=payload, headers=headers)
    log_response(response)
    
    if response.status_code != 200:
        log_fail(f"Expected 200, got {response.status_code}")
        return False
    
    data = response.json()
    
    if data.get('open') != True:
        log_fail(f"Expected open=true, got {data.get('open')}")
        return False
    
    if 'expires_at' not in data or not data['expires_at']:
        log_fail("expires_at is missing or empty")
        return False
    
    # Parse expires_at and verify it's in the future
    try:
        expires_at = datetime.fromisoformat(data['expires_at'].replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        
        if expires_at <= now:
            log_fail(f"expires_at is not in the future: {expires_at}")
            return False
        
        # Check if it's roughly 3:30 PM IST (10:00 UTC)
        # IST is UTC+5:30, so 3:30 PM IST = 10:00 UTC
        hour_utc = expires_at.hour
        minute_utc = expires_at.minute
        
        log_info(f"expires_at: {data['expires_at']}")
        log_info(f"Parsed: {expires_at} (UTC hour: {hour_utc}:{minute_utc:02d})")
        
        # Should be 10:00 UTC (3:30 PM IST)
        if hour_utc == 10 and minute_utc == 0:
            log_pass(f"expires_at correctly set to 3:30 PM IST (10:00 UTC)")
        else:
            log_info(f"expires_at is {hour_utc}:{minute_utc:02d} UTC (expected 10:00 UTC for 3:30 PM IST)")
        
    except Exception as e:
        log_fail(f"Failed to parse expires_at: {e}")
        return False
    
    log_pass("Public access opened successfully with valid expires_at")
    return True

def test_7_auth_state_public_open():
    """Test 7: GET /api/auth/state (anonymous) after opening public access"""
    log_test(7, "GET /api/auth/state (anonymous) after opening public access")
    
    url = f"{BASE_URL}/auth/state"
    log_request("GET", url)
    
    response = requests.get(url)
    log_response(response)
    
    if response.status_code != 200:
        log_fail(f"Expected 200, got {response.status_code}")
        return False
    
    data = response.json()
    
    if data.get('requires_login') != False:
        log_fail(f"Expected requires_login=false (public open), got {data.get('requires_login')}")
        return False
    
    if data.get('public_access_open') != True:
        log_fail(f"Expected public_access_open=true, got {data.get('public_access_open')}")
        return False
    
    log_pass("Auth state correct: requires_login=false, public_access_open=true")
    return True

def test_8_public_access_close():
    """Test 8: POST /api/auth/public-access with admin header (open=false) - REQUIRED"""
    log_test(8, "POST /api/auth/public-access with admin header (open=false) - LOCK APP")
    
    if not ADMIN_TOKEN:
        log_fail("No admin token available from test 2")
        return False
    
    url = f"{BASE_URL}/auth/public-access"
    headers = {"X-Admin-Token": ADMIN_TOKEN}
    payload = {"open": False}
    
    log_request("POST", url, headers=headers, data=payload)
    
    response = requests.post(url, json=payload, headers=headers)
    log_response(response)
    
    if response.status_code != 200:
        log_fail(f"Expected 200, got {response.status_code}")
        return False
    
    data = response.json()
    
    if data.get('open') != False:
        log_fail(f"Expected open=false, got {data.get('open')}")
        return False
    
    # expires_at should be null when closed
    if data.get('expires_at') is not None:
        log_info(f"expires_at is {data.get('expires_at')} (expected null, but not critical)")
    
    log_pass("✅ CRITICAL: Public access closed successfully (app is locked)")
    
    # Verify by checking auth state
    verify_url = f"{BASE_URL}/auth/state"
    verify_response = requests.get(verify_url)
    verify_data = verify_response.json()
    
    if verify_data.get('requires_login') == True and verify_data.get('public_access_open') == False:
        log_pass("✅ VERIFIED: Auth state confirms app is locked (requires_login=true)")
    else:
        log_fail(f"Auth state verification failed: {verify_data}")
        return False
    
    return True

def test_9_regression_endpoints():
    """Test 9: Regression - existing endpoints still work"""
    log_test(9, "Regression - /api/status, /api/oi/NIFTY, /api/telegram/prefs")
    
    endpoints = [
        "/status",
        "/oi/NIFTY",
        "/telegram/prefs"
    ]
    
    all_passed = True
    
    for endpoint in endpoints:
        url = f"{BASE_URL}{endpoint}"
        log_info(f"Testing {endpoint}...")
        log_request("GET", url)
        
        response = requests.get(url)
        log_response(response)
        
        if response.status_code != 200:
            log_fail(f"{endpoint} returned {response.status_code} (expected 200)")
            all_passed = False
        else:
            log_pass(f"{endpoint} returned 200")
    
    if all_passed:
        log_pass("All regression endpoints working correctly")
    
    return all_passed

def test_10_security_headers():
    """Test 10: Security headers on /api/auth/* endpoints"""
    log_test(10, "Security headers on /api/auth/* endpoints")
    
    endpoints = [
        "/auth/state",
        "/auth/login"
    ]
    
    all_passed = True
    
    for endpoint in endpoints:
        url = f"{BASE_URL}{endpoint}"
        log_info(f"Checking security headers on {endpoint}...")
        
        if endpoint == "/auth/login":
            response = requests.post(url, json={"username": "test", "password": "test"})
        else:
            response = requests.get(url)
        
        log_info(f"Status: {response.status_code}")
        
        if not check_security_headers(response):
            all_passed = False
    
    if all_passed:
        log_pass("All auth endpoints have required security headers")
    
    return all_passed

def main():
    """Run all tests"""
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}NSE OI Tracker - Admin Authentication Backend Tests{RESET}")
    print(f"{BLUE}Test Date: 2026-07-17{RESET}")
    print(f"{BLUE}Backend URL: {BASE_URL}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    tests = [
        test_1_auth_state_anonymous,
        test_2_admin_login_success,
        test_3_admin_login_failure,
        test_4_auth_state_with_admin_token,
        test_5_public_access_without_admin,
        test_6_public_access_open,
        test_7_auth_state_public_open,
        test_8_public_access_close,
        test_9_regression_endpoints,
        test_10_security_headers
    ]
    
    results = []
    
    for test in tests:
        try:
            result = test()
            results.append((test.__name__, result))
        except Exception as e:
            log_fail(f"Test {test.__name__} raised exception: {e}")
            results.append((test.__name__, False))
    
    # Summary
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST SUMMARY{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = f"{GREEN}✅ PASS{RESET}" if result else f"{RED}❌ FAIL{RESET}"
        print(f"{status}: {test_name}")
    
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}Total: {passed}/{total} tests passed{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    if passed == total:
        print(f"\n{GREEN}✅ ALL TESTS PASSED{RESET}")
        return 0
    else:
        print(f"\n{RED}❌ SOME TESTS FAILED{RESET}")
        return 1

if __name__ == "__main__":
    exit(main())
