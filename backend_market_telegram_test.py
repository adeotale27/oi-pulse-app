#!/usr/bin/env python3
"""
Market-hours polling + Telegram alerts feature test suite
Tests the new features added on 2026-07-17 for NSE OI Tracker
"""

import requests
import time
from datetime import datetime, timezone
from typing import Dict, List

# Backend URL - using localhost:8001 as per review request
BASE_URL = "http://localhost:8001/api"

# CORS test origins
ALLOWED_ORIGIN = "https://oi-pulse.emergent.host"
EVIL_ORIGIN = "https://evil.example.com"

# Expected security headers
EXPECTED_SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
}

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


def test_market_status():
    """Test 1: GET /api/market/status - market hours info"""
    print("\n" + "="*80)
    print("TEST 1: GET /api/market/status - MARKET HOURS INFO")
    print("="*80)
    
    try:
        response = requests.get(f"{BASE_URL}/market/status", timeout=10)
        
        if response.status_code != 200:
            log_fail("GET /api/market/status", f"Expected 200, got {response.status_code}: {response.text[:200]}")
            return
        
        try:
            data = response.json()
        except ValueError:
            log_fail("GET /api/market/status", f"Invalid JSON response: {response.text[:200]}")
            return
        
        # Check required keys
        required_keys = [
            "is_market_open",
            "now_ist",
            "market_open_ist",
            "market_close_ist",
            "is_weekend",
            "is_holiday",
            "next_market_open_ist",
            "seconds_until_next_open"
        ]
        
        missing_keys = [key for key in required_keys if key not in data]
        if missing_keys:
            log_fail("GET /api/market/status keys", f"Missing keys: {missing_keys}")
            return
        
        log_pass("GET /api/market/status", "200 OK with all required keys")
        
        # Validate key types and values
        if not isinstance(data["is_market_open"], bool):
            log_fail("is_market_open type", f"Expected bool, got {type(data['is_market_open'])}")
        else:
            log_pass("is_market_open", f"bool = {data['is_market_open']}")
        
        # Check now_ist ends with +05:30
        now_ist = data.get("now_ist", "")
        if now_ist.endswith("+05:30"):
            log_pass("now_ist timezone", f"Ends with +05:30: {now_ist}")
        else:
            log_fail("now_ist timezone", f"Expected to end with +05:30, got: {now_ist}")
        
        # Check market_open_ist and market_close_ist
        if data.get("market_open_ist") == "09:00":
            log_pass("market_open_ist", "09:00")
        else:
            log_fail("market_open_ist", f"Expected '09:00', got '{data.get('market_open_ist')}'")
        
        if data.get("market_close_ist") == "15:30":
            log_pass("market_close_ist", "15:30")
        else:
            log_fail("market_close_ist", f"Expected '15:30', got '{data.get('market_close_ist')}'")
        
        # Check is_weekend and is_holiday are bools
        if not isinstance(data["is_weekend"], bool):
            log_fail("is_weekend type", f"Expected bool, got {type(data['is_weekend'])}")
        else:
            log_pass("is_weekend", f"bool = {data['is_weekend']}")
        
        if not isinstance(data["is_holiday"], bool):
            log_fail("is_holiday type", f"Expected bool, got {type(data['is_holiday'])}")
        else:
            log_pass("is_holiday", f"bool = {data['is_holiday']}")
        
        # Check next_market_open_ist logic
        if data["is_market_open"]:
            if data["next_market_open_ist"] is None:
                log_pass("next_market_open_ist (market open)", "null (as expected)")
            else:
                log_warning("next_market_open_ist (market open)", 
                          f"Expected null when market open, got: {data['next_market_open_ist']}")
        else:
            if data["next_market_open_ist"] is not None and isinstance(data["next_market_open_ist"], str):
                log_pass("next_market_open_ist (market closed)", f"ISO string: {data['next_market_open_ist']}")
            else:
                log_fail("next_market_open_ist (market closed)", 
                        f"Expected ISO string when market closed, got: {data['next_market_open_ist']}")
        
        # Check seconds_until_next_open is int
        if isinstance(data["seconds_until_next_open"], int):
            log_pass("seconds_until_next_open", f"int = {data['seconds_until_next_open']}")
        else:
            log_fail("seconds_until_next_open type", 
                    f"Expected int, got {type(data['seconds_until_next_open'])}")
        
    except requests.exceptions.Timeout:
        log_fail("GET /api/market/status", "Request timed out after 10s")
    except Exception as e:
        log_fail("GET /api/market/status", f"{type(e).__name__}: {str(e)}")


def test_telegram_status():
    """Test 2: GET /api/telegram/status - should return {configured: true}"""
    print("\n" + "="*80)
    print("TEST 2: GET /api/telegram/status - TELEGRAM CONFIGURATION")
    print("="*80)
    
    try:
        response = requests.get(f"{BASE_URL}/telegram/status", timeout=10)
        
        if response.status_code != 200:
            log_fail("GET /api/telegram/status", f"Expected 200, got {response.status_code}: {response.text[:200]}")
            return
        
        try:
            data = response.json()
        except ValueError:
            log_fail("GET /api/telegram/status", f"Invalid JSON response: {response.text[:200]}")
            return
        
        if "configured" not in data:
            log_fail("GET /api/telegram/status", f"Missing 'configured' key in response: {data}")
            return
        
        if data["configured"] is True:
            log_pass("GET /api/telegram/status", "configured = true")
        else:
            log_fail("GET /api/telegram/status", f"Expected configured=true, got {data['configured']}")
        
    except requests.exceptions.Timeout:
        log_fail("GET /api/telegram/status", "Request timed out after 10s")
    except Exception as e:
        log_fail("GET /api/telegram/status", f"{type(e).__name__}: {str(e)}")


def test_telegram_test_message():
    """Test 3: POST /api/telegram/test - send test message (CALL ONLY ONCE)"""
    print("\n" + "="*80)
    print("TEST 3: POST /api/telegram/test - SEND TEST MESSAGE")
    print("="*80)
    print("⚠️  NOTE: Calling this endpoint ONLY ONCE to avoid spamming user's phone")
    
    try:
        response = requests.post(f"{BASE_URL}/telegram/test", timeout=15)
        
        if response.status_code != 200:
            log_fail("POST /api/telegram/test", f"Expected 200, got {response.status_code}: {response.text[:200]}")
            return
        
        try:
            data = response.json()
        except ValueError:
            log_fail("POST /api/telegram/test", f"Invalid JSON response: {response.text[:200]}")
            return
        
        # Check for required keys
        if "ok" not in data or "sent" not in data:
            log_fail("POST /api/telegram/test", f"Missing 'ok' or 'sent' keys in response: {data}")
            return
        
        if data["ok"] is True and data["sent"] is True:
            log_pass("POST /api/telegram/test", "ok=true, sent=true (test message sent successfully)")
        else:
            log_fail("POST /api/telegram/test", f"Expected ok=true and sent=true, got: {data}")
        
    except requests.exceptions.Timeout:
        log_fail("POST /api/telegram/test", "Request timed out after 15s")
    except Exception as e:
        log_fail("POST /api/telegram/test", f"{type(e).__name__}: {str(e)}")


def test_status_extended():
    """Test 4: GET /api/status - extended with market, telegram_configured, retention_hours, always_poll"""
    print("\n" + "="*80)
    print("TEST 4: GET /api/status - EXTENDED STATUS WITH NEW FIELDS")
    print("="*80)
    
    try:
        response = requests.get(f"{BASE_URL}/status", timeout=10)
        
        if response.status_code != 200:
            log_fail("GET /api/status", f"Expected 200, got {response.status_code}: {response.text[:200]}")
            return
        
        try:
            data = response.json()
        except ValueError:
            log_fail("GET /api/status", f"Invalid JSON response: {response.text[:200]}")
            return
        
        # Check for new fields
        required_fields = {
            "market": dict,
            "telegram_configured": bool,
            "retention_hours": int,
            "always_poll": bool,
            "mode": str,
            "running": bool,
        }
        
        for field, expected_type in required_fields.items():
            if field not in data:
                log_fail(f"GET /api/status field '{field}'", "Missing from response")
            elif not isinstance(data[field], expected_type):
                log_fail(f"GET /api/status field '{field}'", 
                        f"Expected type {expected_type.__name__}, got {type(data[field]).__name__}")
            else:
                log_pass(f"GET /api/status field '{field}'", f"{expected_type.__name__} = {data[field]}")
        
        # Validate market object structure
        if "market" in data and isinstance(data["market"], dict):
            market = data["market"]
            market_required_keys = [
                "is_market_open",
                "now_ist",
                "market_open_ist",
                "market_close_ist",
                "is_weekend",
                "is_holiday",
            ]
            missing_market_keys = [key for key in market_required_keys if key not in market]
            if missing_market_keys:
                log_fail("GET /api/status market object", f"Missing keys: {missing_market_keys}")
            else:
                log_pass("GET /api/status market object", "All required keys present")
        
        # Check specific values
        if data.get("telegram_configured") is True:
            log_pass("telegram_configured", "true (Telegram is configured)")
        else:
            log_fail("telegram_configured", f"Expected true, got {data.get('telegram_configured')}")
        
        if data.get("retention_hours") == 24:
            log_pass("retention_hours", "24 (as configured)")
        else:
            log_warning("retention_hours", f"Expected 24, got {data.get('retention_hours')}")
        
        if data.get("always_poll") is False:
            log_pass("always_poll", "false (market-hours aware polling)")
        else:
            log_warning("always_poll", f"Expected false, got {data.get('always_poll')}")
        
        if data.get("mode") == "kite":
            log_pass("mode", "kite (as required)")
        else:
            log_fail("mode", f"Expected 'kite', got '{data.get('mode')}'")
        
        if data.get("running") is True:
            log_pass("running", "true (tracker is running)")
        else:
            log_fail("running", f"Expected true, got {data.get('running')}")
        
    except requests.exceptions.Timeout:
        log_fail("GET /api/status", "Request timed out after 10s")
    except Exception as e:
        log_fail("GET /api/status", f"{type(e).__name__}: {str(e)}")


def test_tracker_functional():
    """Test 5: Tracker functional check - polling is happening"""
    print("\n" + "="*80)
    print("TEST 5: TRACKER FUNCTIONAL CHECK - POLLING IS HAPPENING")
    print("="*80)
    
    # First, get current status to check last_updated_at
    try:
        response1 = requests.get(f"{BASE_URL}/status", timeout=10)
        if response1.status_code != 200:
            log_fail("Tracker functional check (status)", f"Status endpoint returned {response1.status_code}")
            return
        
        status1 = response1.json()
        last_updated_1 = status1.get("last_updated_at")
        
        if last_updated_1:
            log_pass("Tracker last_updated_at (initial)", f"{last_updated_1}")
        else:
            log_warning("Tracker last_updated_at (initial)", "null (tracker may not have polled yet)")
        
    except Exception as e:
        log_fail("Tracker functional check (status)", f"{type(e).__name__}: {str(e)}")
        return
    
    # Get OI data for NIFTY
    try:
        response2 = requests.get(f"{BASE_URL}/oi/NIFTY", timeout=10)
        
        if response2.status_code != 200:
            log_fail("GET /api/oi/NIFTY", f"Expected 200, got {response2.status_code}: {response2.text[:200]}")
            return
        
        try:
            data = response2.json()
        except ValueError:
            log_fail("GET /api/oi/NIFTY", f"Invalid JSON response: {response2.text[:200]}")
            return
        
        # Check for strikes data
        if "strikes" in data and isinstance(data["strikes"], list) and len(data["strikes"]) > 0:
            log_pass("GET /api/oi/NIFTY", f"200 OK with {len(data['strikes'])} strikes")
        else:
            log_fail("GET /api/oi/NIFTY", f"Expected strikes array with data, got: {data.keys()}")
            return
        
    except requests.exceptions.Timeout:
        log_fail("GET /api/oi/NIFTY", "Request timed out after 10s")
        return
    except Exception as e:
        log_fail("GET /api/oi/NIFTY", f"{type(e).__name__}: {str(e)}")
        return
    
    # Wait ~20 seconds and check if last_updated_at has changed
    print("\n⏳ Waiting 20 seconds to verify polling is happening...")
    time.sleep(20)
    
    try:
        response3 = requests.get(f"{BASE_URL}/status", timeout=10)
        if response3.status_code != 200:
            log_fail("Tracker functional check (status after wait)", f"Status endpoint returned {response3.status_code}")
            return
        
        status2 = response3.json()
        last_updated_2 = status2.get("last_updated_at")
        
        if last_updated_2:
            log_pass("Tracker last_updated_at (after 20s)", f"{last_updated_2}")
            
            # Check if it's recent (within last 30 seconds)
            try:
                updated_dt = datetime.fromisoformat(last_updated_2.replace('Z', '+00:00'))
                now = datetime.now(timezone.utc)
                age_seconds = (now - updated_dt).total_seconds()
                
                if age_seconds <= 30:
                    log_pass("Tracker polling verification", f"last_updated_at is recent ({age_seconds:.1f}s old)")
                else:
                    log_warning("Tracker polling verification", 
                              f"last_updated_at is {age_seconds:.1f}s old (expected < 30s)")
            except Exception as e:
                log_warning("Tracker polling verification", f"Could not parse timestamp: {e}")
        else:
            log_fail("Tracker last_updated_at (after 20s)", "Still null after waiting")
        
    except Exception as e:
        log_fail("Tracker functional check (status after wait)", f"{type(e).__name__}: {str(e)}")


def test_cors_security_headers_new_endpoints():
    """Test 6: CORS + security headers regression on new endpoints"""
    print("\n" + "="*80)
    print("TEST 6: CORS + SECURITY HEADERS ON NEW ENDPOINTS")
    print("="*80)
    
    new_endpoints = [
        "/market/status",
        "/telegram/status",
    ]
    
    for endpoint in new_endpoints:
        print(f"\n--- Testing {endpoint} ---")
        
        # Test security headers
        try:
            response = requests.get(f"{BASE_URL}{endpoint}", timeout=10)
            headers_lower = {k.lower(): v for k, v in response.headers.items()}
            
            all_present = True
            for header_name, expected_value in EXPECTED_SECURITY_HEADERS.items():
                actual_value = headers_lower.get(header_name)
                if actual_value:
                    if actual_value == expected_value:
                        log_pass(f"{endpoint} header '{header_name}'", f"'{expected_value}'")
                    else:
                        log_warning(f"{endpoint} header '{header_name}'", 
                                  f"Expected '{expected_value}', got '{actual_value}'")
                else:
                    log_fail(f"{endpoint} header '{header_name}'", "Header missing")
                    all_present = False
        except Exception as e:
            log_fail(f"{endpoint} security headers", f"{type(e).__name__}: {str(e)}")
            continue
        
        # Test CORS with allowed origin
        try:
            response = requests.get(
                f"{BASE_URL}{endpoint}",
                headers={"Origin": ALLOWED_ORIGIN},
                timeout=10
            )
            cors_header = response.headers.get("access-control-allow-origin")
            if cors_header == ALLOWED_ORIGIN:
                log_pass(f"{endpoint} CORS allowed origin", f"'{ALLOWED_ORIGIN}' echoed")
            else:
                log_fail(f"{endpoint} CORS allowed origin", 
                        f"Expected '{ALLOWED_ORIGIN}', got '{cors_header}'")
        except Exception as e:
            log_fail(f"{endpoint} CORS allowed origin", f"{type(e).__name__}: {str(e)}")
        
        # Test CORS with evil origin
        try:
            response = requests.get(
                f"{BASE_URL}{endpoint}",
                headers={"Origin": EVIL_ORIGIN},
                timeout=10
            )
            cors_header = response.headers.get("access-control-allow-origin")
            if cors_header is None or cors_header != EVIL_ORIGIN:
                log_pass(f"{endpoint} CORS evil origin blocked", 
                        f"Evil origin not echoed (header: {cors_header})")
            else:
                log_fail(f"{endpoint} CORS evil origin blocked", 
                        f"Evil origin '{EVIL_ORIGIN}' was echoed - security breach!")
        except Exception as e:
            log_fail(f"{endpoint} CORS evil origin", f"{type(e).__name__}: {str(e)}")


def print_summary():
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    total_tests = len(test_results["passed"]) + len(test_results["failed"])
    
    print(f"\n✅ PASSED: {len(test_results['passed'])}/{total_tests}")
    if test_results["passed"]:
        for test in test_results["passed"][:10]:  # Show first 10
            print(f"   • {test}")
        if len(test_results["passed"]) > 10:
            print(f"   ... and {len(test_results['passed']) - 10} more")
    
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
    print("NSE OI TRACKER - MARKET-HOURS POLLING + TELEGRAM ALERTS TEST SUITE")
    print("="*80)
    print(f"Backend URL: {BASE_URL}")
    print(f"Test Date: {time.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("="*80)
    print("\n⚠️  IMPORTANT CONSTRAINTS:")
    print("   • POST /api/telegram/test will be called ONLY ONCE")
    print("   • Mode will remain 'kite' (no mode changes)")
    print("   • No vault wipes, alert deletions, or rate-limit flooding")
    print("="*80)
    
    # Run all tests
    test_market_status()
    test_telegram_status()
    test_telegram_test_message()
    test_status_extended()
    test_tracker_functional()
    test_cors_security_headers_new_endpoints()
    
    # Print summary
    print_summary()
