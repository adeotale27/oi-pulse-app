#!/usr/bin/env python3
"""
Backend Security Hardening Test Suite
Tests production security middleware for NSE OI Tracker deployment on oi-pulse.emergent.host
"""

import requests
import time
from typing import Dict, List, Tuple

# Backend URL - using localhost:8001 as per review request
# (external URL has TrustedHostMiddleware that blocks direct Python requests)
BASE_URL = "http://localhost:8001/api"

# Expected security headers
EXPECTED_SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "geolocation=(), microphone=(), camera=()",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
}

# CORS test origins
ALLOWED_ORIGIN = "https://oi-pulse.emergent.host"
EVIL_ORIGIN = "https://evil.example.com"

# Test results tracking
test_results = {
    "passed": [],
    "failed": [],
    "warnings": [],
}


def log_pass(test_name: str, details: str = ""):
    """Log a passing test"""
    msg = f"✅ {test_name}"
    if details:
        msg += f": {details}"
    print(msg)
    test_results["passed"].append(test_name)


def log_fail(test_name: str, details: str):
    """Log a failing test"""
    msg = f"❌ {test_name}: {details}"
    print(msg)
    test_results["failed"].append(f"{test_name}: {details}")


def log_warning(test_name: str, details: str):
    """Log a warning"""
    msg = f"⚠️  {test_name}: {details}"
    print(msg)
    test_results["warnings"].append(f"{test_name}: {details}")


def test_regression_sanity_check():
    """Test 1: Regression sanity check on read-only endpoints"""
    print("\n" + "="*80)
    print("TEST 1: REGRESSION SANITY CHECK - READ-ONLY ENDPOINTS")
    print("="*80)
    
    endpoints = [
        ("/", "Root endpoint"),
        ("/status", "Status endpoint"),
        ("/config", "Config endpoint"),
        ("/oi/NIFTY", "OI NIFTY endpoint"),
        ("/history/NIFTY?minutes=30", "History NIFTY 30min"),
        ("/vrp/NIFTY", "VRP NIFTY endpoint"),
    ]
    
    for path, description in endpoints:
        try:
            url = f"{BASE_URL}{path}"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    log_pass(f"GET {path}", f"200 OK, valid JSON ({len(str(data))} bytes)")
                except ValueError:
                    log_fail(f"GET {path}", f"200 but invalid JSON: {response.text[:100]}")
            else:
                log_fail(f"GET {path}", f"Expected 200, got {response.status_code}: {response.text[:200]}")
        except requests.exceptions.Timeout:
            log_fail(f"GET {path}", "Request timed out after 10s")
        except Exception as e:
            log_fail(f"GET {path}", f"{type(e).__name__}: {str(e)}")


def test_security_headers():
    """Test 2: Verify security headers are present on all responses"""
    print("\n" + "="*80)
    print("TEST 2: SECURITY HEADERS VERIFICATION")
    print("="*80)
    
    try:
        response = requests.get(f"{BASE_URL}/", timeout=10)
        headers_lower = {k.lower(): v for k, v in response.headers.items()}
        
        all_present = True
        for header_name, expected_value in EXPECTED_SECURITY_HEADERS.items():
            actual_value = headers_lower.get(header_name)
            if actual_value:
                if actual_value == expected_value:
                    log_pass(f"Security header '{header_name}'", f"'{expected_value}'")
                else:
                    log_warning(f"Security header '{header_name}'", 
                              f"Expected '{expected_value}', got '{actual_value}'")
            else:
                log_fail(f"Security header '{header_name}'", "Header missing")
                all_present = False
        
        if all_present:
            log_pass("All security headers", "All 5 required headers present")
    except Exception as e:
        log_fail("Security headers test", f"{type(e).__name__}: {str(e)}")


def test_cors_restriction():
    """Test 3: CORS restriction - allowed origin vs evil origin"""
    print("\n" + "="*80)
    print("TEST 3: CORS RESTRICTION")
    print("="*80)
    
    # Test 3a: Allowed origin
    try:
        response = requests.get(
            f"{BASE_URL}/",
            headers={"Origin": ALLOWED_ORIGIN},
            timeout=10
        )
        cors_header = response.headers.get("access-control-allow-origin")
        if cors_header == ALLOWED_ORIGIN:
            log_pass("CORS allowed origin", f"'{ALLOWED_ORIGIN}' echoed correctly")
        else:
            log_fail("CORS allowed origin", 
                    f"Expected '{ALLOWED_ORIGIN}', got '{cors_header}'")
    except Exception as e:
        log_fail("CORS allowed origin test", f"{type(e).__name__}: {str(e)}")
    
    # Test 3b: Evil origin
    try:
        response = requests.get(
            f"{BASE_URL}/",
            headers={"Origin": EVIL_ORIGIN},
            timeout=10
        )
        cors_header = response.headers.get("access-control-allow-origin")
        if cors_header is None or cors_header != EVIL_ORIGIN:
            log_pass("CORS evil origin blocked", 
                    f"Evil origin '{EVIL_ORIGIN}' not echoed (header: {cors_header})")
        else:
            log_fail("CORS evil origin blocked", 
                    f"Evil origin '{EVIL_ORIGIN}' was echoed - security breach!")
    except Exception as e:
        log_fail("CORS evil origin test", f"{type(e).__name__}: {str(e)}")
    
    # Test 3c: Preflight OPTIONS request with allowed origin
    try:
        response = requests.options(
            f"{BASE_URL}/mode",
            headers={
                "Origin": ALLOWED_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
            timeout=10
        )
        if response.status_code == 200:
            cors_header = response.headers.get("access-control-allow-origin")
            if cors_header == ALLOWED_ORIGIN:
                log_pass("CORS preflight OPTIONS", 
                        f"200 OK with correct CORS headers for '{ALLOWED_ORIGIN}'")
            else:
                log_warning("CORS preflight OPTIONS", 
                          f"200 but CORS header is '{cors_header}' instead of '{ALLOWED_ORIGIN}'")
        else:
            log_warning("CORS preflight OPTIONS", 
                       f"Expected 200, got {response.status_code}")
    except Exception as e:
        log_fail("CORS preflight test", f"{type(e).__name__}: {str(e)}")


def test_rate_limiter():
    """Test 4: Rate limiter on POST /api/mode (20 req/60s limit)"""
    print("\n" + "="*80)
    print("TEST 4: RATE LIMITER ON POST /api/mode")
    print("="*80)
    print("⏳ Sending 25 rapid POST requests to /api/mode...")
    print("   Expected: First 20 succeed (200), requests 21-25 return 429")
    print("   Note: Mode will stay as 'kite' (sending same mode repeatedly)")
    
    success_count = 0
    rate_limited_count = 0
    other_errors = []
    
    for i in range(1, 26):
        try:
            response = requests.post(
                f"{BASE_URL}/mode",
                json={"mode": "kite"},  # Keep mode as kite
                headers={"Content-Type": "application/json"},
                timeout=10
            )
            
            if response.status_code == 200:
                success_count += 1
                if i <= 20:
                    print(f"   Request {i:2d}/25: ✅ 200 OK (expected)")
                else:
                    print(f"   Request {i:2d}/25: ⚠️  200 OK (expected 429 after 20th request)")
            elif response.status_code == 429:
                rate_limited_count += 1
                try:
                    error_detail = response.json().get("detail", "")
                    if "Too many requests" in error_detail:
                        print(f"   Request {i:2d}/25: ✅ 429 Rate Limited (expected)")
                    else:
                        print(f"   Request {i:2d}/25: ⚠️  429 but unexpected detail: {error_detail}")
                except:
                    print(f"   Request {i:2d}/25: ✅ 429 Rate Limited")
            else:
                other_errors.append((i, response.status_code, response.text[:100]))
                print(f"   Request {i:2d}/25: ❌ {response.status_code} (unexpected)")
        except Exception as e:
            other_errors.append((i, "Exception", str(e)))
            print(f"   Request {i:2d}/25: ❌ {type(e).__name__}: {str(e)}")
    
    print(f"\n📊 Rate Limiter Results:")
    print(f"   Success (200): {success_count}")
    print(f"   Rate Limited (429): {rate_limited_count}")
    print(f"   Other Errors: {len(other_errors)}")
    
    # Evaluate results
    if success_count == 20 and rate_limited_count == 5:
        log_pass("Rate limiter", "Exactly 20 succeeded, 5 rate-limited (perfect)")
    elif success_count <= 20 and rate_limited_count >= 5:
        log_pass("Rate limiter", f"{success_count} succeeded, {rate_limited_count} rate-limited (working)")
    elif rate_limited_count > 0:
        log_warning("Rate limiter", 
                   f"Partially working: {success_count} succeeded, {rate_limited_count} rate-limited")
    else:
        log_fail("Rate limiter", f"Not working: {success_count} succeeded, 0 rate-limited")
    
    if other_errors:
        for req_num, status, detail in other_errors:
            log_warning(f"Rate limiter request {req_num}", f"{status}: {detail}")


def verify_mode_still_kite():
    """Verify that mode is still 'kite' after all tests"""
    print("\n" + "="*80)
    print("VERIFICATION: MODE STILL 'KITE'")
    print("="*80)
    
    try:
        response = requests.get(f"{BASE_URL}/status", timeout=10)
        if response.status_code == 200:
            data = response.json()
            mode = data.get("mode")
            if mode == "kite":
                log_pass("Mode verification", "Mode is still 'kite' ✅")
            else:
                log_fail("Mode verification", f"Mode changed to '{mode}' (expected 'kite')")
        else:
            log_fail("Mode verification", f"Status endpoint returned {response.status_code}")
    except Exception as e:
        log_fail("Mode verification", f"{type(e).__name__}: {str(e)}")


def print_summary():
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    total_tests = len(test_results["passed"]) + len(test_results["failed"])
    
    print(f"\n✅ PASSED: {len(test_results['passed'])}/{total_tests}")
    if test_results["passed"]:
        for test in test_results["passed"]:
            print(f"   • {test}")
    
    if test_results["failed"]:
        print(f"\n❌ FAILED: {len(test_results['failed'])}/{total_tests}")
        for test in test_results["failed"]:
            print(f"   • {test}")
    
    if test_results["warnings"]:
        print(f"\n⚠️  WARNINGS: {len(test_results['warnings'])}")
        for warning in test_results["warnings"]:
            print(f"   • {warning}")
    
    print("\n" + "="*80)
    if test_results["failed"]:
        print("❌ OVERALL: SOME TESTS FAILED")
    elif test_results["warnings"]:
        print("⚠️  OVERALL: ALL TESTS PASSED WITH WARNINGS")
    else:
        print("✅ OVERALL: ALL TESTS PASSED")
    print("="*80 + "\n")


if __name__ == "__main__":
    print("="*80)
    print("NSE OI TRACKER - PRODUCTION SECURITY HARDENING TEST SUITE")
    print("="*80)
    print(f"Backend URL: {BASE_URL}")
    print(f"Test Date: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    # Run all tests
    test_regression_sanity_check()
    test_security_headers()
    test_cors_restriction()
    test_rate_limiter()
    verify_mode_still_kite()
    
    # Print summary
    print_summary()
