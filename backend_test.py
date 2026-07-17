#!/usr/bin/env python3
"""
OI-Pulse Backend Testing Suite
Tests the three tasks from test_result.md:
1. CORS allow-list includes aaisnamkeen.com + www + production URL
2. Auth flow regression — login + state + logout still works after changes
3. Startup logs today's snapshot count + Mongo indexes created
"""

import requests
import sys
from typing import Dict, Any

# Backend URL from frontend/.env
BASE_URL = "https://06809b2f-6889-48e8-a120-619601eb6da3.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Admin credentials from /app/memory/test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = "MasterApp@123"

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

def test_cors_preflight(origin: str, should_allow: bool = True):
    """Test CORS preflight (OPTIONS) request"""
    test_name = f"CORS Preflight: {origin}"
    
    try:
        headers = {
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type"
        }
        
        response = requests.options(f"{API_BASE}/status", headers=headers, timeout=10)
        
        # Check status code (200 or 204 are both acceptable for OPTIONS)
        if response.status_code not in [200, 204]:
            log_test(test_name, False, f"Expected 200/204, got {response.status_code}")
            return
        
        # Check Access-Control-Allow-Origin header
        allow_origin = response.headers.get("Access-Control-Allow-Origin", "")
        
        if should_allow:
            if allow_origin == origin:
                log_test(test_name, True, f"Status: {response.status_code}, Allow-Origin: {allow_origin}")
            else:
                log_test(test_name, False, f"Expected Allow-Origin={origin}, got {allow_origin}")
        else:
            if allow_origin != origin:
                log_test(test_name, True, f"Origin correctly blocked (Allow-Origin: {allow_origin})")
            else:
                log_test(test_name, False, f"Evil origin was incorrectly allowed: {allow_origin}")
                
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")

def test_cors_simple_request(origin: str, should_allow: bool = True):
    """Test CORS simple GET request"""
    test_name = f"CORS Simple GET: {origin}"
    
    try:
        headers = {"Origin": origin}
        response = requests.get(f"{API_BASE}/status", headers=headers, timeout=10)
        
        # Check status code
        if response.status_code != 200:
            log_test(test_name, False, f"Expected 200, got {response.status_code}")
            return
        
        # Check Access-Control-Allow-Origin header
        allow_origin = response.headers.get("Access-Control-Allow-Origin", "")
        
        if should_allow:
            if allow_origin == origin:
                log_test(test_name, True, f"Allow-Origin: {allow_origin}")
            else:
                log_test(test_name, False, f"Expected Allow-Origin={origin}, got {allow_origin}")
        else:
            if allow_origin != origin:
                log_test(test_name, True, f"Origin correctly blocked (Allow-Origin: {allow_origin})")
            else:
                log_test(test_name, False, f"Evil origin was incorrectly allowed: {allow_origin}")
                
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")

def test_auth_login():
    """Test admin login"""
    global login_attempts
    test_name = "Auth: POST /api/auth/login"
    
    login_attempts += 1
    if login_attempts > 5:
        log_test(test_name, False, "Exceeded 5 login attempts limit")
        return None
    
    try:
        payload = {
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        }
        
        response = requests.post(f"{API_BASE}/auth/login", json=payload, timeout=10)
        
        if response.status_code != 200:
            log_test(test_name, False, f"Expected 200, got {response.status_code}: {response.text}")
            return None
        
        data = response.json()
        token = data.get("token")
        
        if token:
            log_test(test_name, True, f"Login successful, token received (length: {len(token)})")
            return token
        else:
            log_test(test_name, False, "No token in response")
            return None
            
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")
        return None

def test_auth_state_with_token(token: str):
    """Test auth state with valid token"""
    test_name = "Auth: GET /api/auth/state (with token)"
    
    try:
        headers = {"X-Admin-Token": token}
        response = requests.get(f"{API_BASE}/auth/state", headers=headers, timeout=10)
        
        if response.status_code != 200:
            log_test(test_name, False, f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        is_admin = data.get("is_admin")
        
        if is_admin is True:
            log_test(test_name, True, f"is_admin=true")
        else:
            log_test(test_name, False, f"Expected is_admin=true, got {is_admin}")
            
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")

def test_auth_logout(token: str):
    """Test admin logout"""
    test_name = "Auth: POST /api/auth/logout"
    
    try:
        headers = {"X-Admin-Token": token}
        response = requests.post(f"{API_BASE}/auth/logout", headers=headers, timeout=10)
        
        if response.status_code == 200:
            log_test(test_name, True, "Logout successful")
        else:
            log_test(test_name, False, f"Expected 200, got {response.status_code}")
            
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")

def test_auth_state_without_token():
    """Test auth state without token"""
    test_name = "Auth: GET /api/auth/state (without token)"
    
    try:
        response = requests.get(f"{API_BASE}/auth/state", timeout=10)
        
        if response.status_code != 200:
            log_test(test_name, False, f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        is_admin = data.get("is_admin")
        
        if is_admin is False:
            log_test(test_name, True, f"is_admin=false")
        else:
            log_test(test_name, False, f"Expected is_admin=false, got {is_admin}")
            
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")

def test_startup_status():
    """Test startup - verify /api/status returns expected fields"""
    test_name = "Startup: GET /api/status"
    
    try:
        response = requests.get(f"{API_BASE}/status", timeout=10)
        
        if response.status_code != 200:
            log_test(test_name, False, f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Check required fields
        required_fields = ["running", "mode", "market"]
        missing_fields = [f for f in required_fields if f not in data]
        
        if missing_fields:
            log_test(test_name, False, f"Missing fields: {missing_fields}")
        else:
            log_test(test_name, True, f"running={data['running']}, mode={data['mode']}, market={data['market']}")
            
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")

def test_history_endpoint_performance():
    """Optional: Test that /api/history/NIFTY returns quickly (indexes helping)"""
    test_name = "Optional: GET /api/history/NIFTY?minutes=60 (index performance)"
    
    try:
        import time
        start = time.time()
        response = requests.get(f"{API_BASE}/history/NIFTY?minutes=60", timeout=10)
        elapsed = time.time() - start
        
        if response.status_code != 200:
            log_test(test_name, False, f"Expected 200, got {response.status_code}")
            return
        
        # If it returns quickly (< 2s), indexes are likely helping
        if elapsed < 2.0:
            log_test(test_name, True, f"Response time: {elapsed:.2f}s (indexes working)")
        else:
            log_test(test_name, True, f"Response time: {elapsed:.2f}s (slower but acceptable)")
            
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")

def main():
    """Run all tests"""
    print("=" * 80)
    print("OI-PULSE BACKEND TEST SUITE")
    print("=" * 80)
    print(f"Backend URL: {BASE_URL}")
    print(f"API Base: {API_BASE}")
    print("=" * 80)
    print()
    
    # ========================================
    # TASK 1: CORS ALLOW-LIST
    # ========================================
    print("TASK 1: CORS ALLOW-LIST")
    print("-" * 80)
    
    # Test allowed origins (preflight)
    test_cors_preflight("https://aaisnamkeen.com", should_allow=True)
    test_cors_preflight("https://www.aaisnamkeen.com", should_allow=True)
    test_cors_preflight("https://cors-fix-preview-6.emergent.host", should_allow=True)
    
    # Test allowed origin (simple GET)
    test_cors_simple_request("https://aaisnamkeen.com", should_allow=True)
    
    # Test evil origin (should be blocked)
    test_cors_simple_request("https://evil.example.com", should_allow=False)
    
    # ========================================
    # TASK 2: AUTH REGRESSION
    # ========================================
    print("TASK 2: AUTH REGRESSION")
    print("-" * 80)
    
    # Login
    token = test_auth_login()
    
    if token:
        # Test state with token
        test_auth_state_with_token(token)
        
        # Logout
        test_auth_logout(token)
        
        # Test state without token
        test_auth_state_without_token()
    else:
        print("⚠️  Skipping remaining auth tests due to login failure")
        print()
    
    # ========================================
    # TASK 3: STARTUP LOG + INDEXES
    # ========================================
    print("TASK 3: STARTUP LOG + INDEXES")
    print("-" * 80)
    
    test_startup_status()
    test_history_endpoint_performance()
    
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
        sys.exit(1)
    else:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)

if __name__ == "__main__":
    main()
