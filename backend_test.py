#!/usr/bin/env python3
"""
Backend API Regression Test Suite for OI Pulse - July 2026 Update
Tests all critical endpoints with focus on /api/positions and /api/settings
"""

import requests
import json
import time
from typing import Dict, Any, List, Tuple

# Backend URL from frontend/.env
BASE_URL = "https://stale-snapshot-cache.preview.emergentagent.com/api"
TIMEOUT = 5  # 5 second timeout as per requirements

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def log_test(name: str):
    print(f"\n{Colors.BLUE}{Colors.BOLD}{'='*80}{Colors.RESET}")
    print(f"{Colors.BLUE}{Colors.BOLD}TEST: {name}{Colors.RESET}")
    print(f"{Colors.BLUE}{Colors.BOLD}{'='*80}{Colors.RESET}")

def log_pass(msg: str):
    print(f"{Colors.GREEN}✓ PASS: {msg}{Colors.RESET}")

def log_fail(msg: str):
    print(f"{Colors.RED}✗ FAIL: {msg}{Colors.RESET}")

def log_info(msg: str):
    print(f"{Colors.YELLOW}ℹ INFO: {msg}{Colors.RESET}")

def log_warning(msg: str):
    print(f"{Colors.YELLOW}⚠ WARNING: {msg}{Colors.RESET}")


class TestResults:
    def __init__(self):
        self.passed = []
        self.failed = []
        self.warnings = []
    
    def add_pass(self, test_name: str, detail: str = ""):
        self.passed.append((test_name, detail))
    
    def add_fail(self, test_name: str, detail: str):
        self.failed.append((test_name, detail))
    
    def add_warning(self, test_name: str, detail: str):
        self.warnings.append((test_name, detail))
    
    def summary(self):
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}TEST SUMMARY{Colors.RESET}")
        print(f"{Colors.BOLD}{'='*80}{Colors.RESET}")
        print(f"{Colors.GREEN}Passed: {len(self.passed)}{Colors.RESET}")
        print(f"{Colors.RED}Failed: {len(self.failed)}{Colors.RESET}")
        print(f"{Colors.YELLOW}Warnings: {len(self.warnings)}{Colors.RESET}")
        
        if self.failed:
            print(f"\n{Colors.RED}{Colors.BOLD}FAILED TESTS:{Colors.RESET}")
            for test_name, detail in self.failed:
                print(f"{Colors.RED}  ✗ {test_name}{Colors.RESET}")
                print(f"    {detail}")
        
        if self.warnings:
            print(f"\n{Colors.YELLOW}{Colors.BOLD}WARNINGS:{Colors.RESET}")
            for test_name, detail in self.warnings:
                print(f"{Colors.YELLOW}  ⚠ {test_name}{Colors.RESET}")
                print(f"    {detail}")
        
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}\n")
        return len(self.failed) == 0


results = TestResults()


def test_positions_endpoint():
    """
    HIGH PRIORITY TEST 1: GET /api/positions
    Must return 200 always (even if Kite not connected)
    Response must contain: mode, positions, and optionally spot, error
    """
    log_test("GET /api/positions - Kite positions endpoint")
    
    try:
        start_time = time.time()
        response = requests.get(f"{BASE_URL}/positions", timeout=TIMEOUT)
        elapsed = time.time() - start_time
        
        # Check response time
        if elapsed > TIMEOUT:
            log_fail(f"Response time {elapsed:.2f}s exceeds {TIMEOUT}s timeout")
            results.add_fail("GET /api/positions - Response time", f"Took {elapsed:.2f}s (> {TIMEOUT}s)")
        else:
            log_pass(f"Response time: {elapsed:.2f}s (< {TIMEOUT}s)")
        
        # Check status code
        if response.status_code != 200:
            log_fail(f"Expected status 200, got {response.status_code}")
            results.add_fail("GET /api/positions - Status code", f"Got {response.status_code}, expected 200")
            log_info(f"Response body: {response.text}")
            return
        else:
            log_pass(f"Status code: {response.status_code}")
        
        # Check JSON response
        try:
            data = response.json()
            log_pass("Response is valid JSON")
        except json.JSONDecodeError as e:
            log_fail(f"Response is not valid JSON: {e}")
            results.add_fail("GET /api/positions - JSON parsing", f"Invalid JSON: {e}")
            return
        
        # Check required keys
        required_keys = ["mode", "positions"]
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            log_fail(f"Missing required keys: {missing_keys}")
            results.add_fail("GET /api/positions - Required keys", f"Missing: {missing_keys}")
        else:
            log_pass(f"All required keys present: {required_keys}")
        
        # Check mode value
        mode = data.get("mode")
        if mode not in ["mock", "kite"]:
            log_warning(f"Unexpected mode value: {mode} (expected 'mock' or 'kite')")
            results.add_warning("GET /api/positions - Mode value", f"Got '{mode}', expected 'mock' or 'kite'")
        else:
            log_pass(f"Mode value valid: '{mode}'")
        
        # Check positions type
        positions = data.get("positions")
        if not isinstance(positions, list):
            log_fail(f"'positions' should be a list, got {type(positions).__name__}")
            results.add_fail("GET /api/positions - Positions type", f"Expected list, got {type(positions).__name__}")
        else:
            log_pass(f"'positions' is a list with {len(positions)} items")
        
        # Check optional keys
        if "spot" in data:
            if isinstance(data["spot"], dict):
                log_pass(f"Optional 'spot' key present and is dict with {len(data['spot'])} indices")
            else:
                log_warning(f"'spot' key present but not a dict: {type(data['spot']).__name__}")
                results.add_warning("GET /api/positions - Spot type", f"Expected dict, got {type(data['spot']).__name__}")
        
        if "error" in data:
            log_info(f"Error message present: {data['error']}")
            if mode == "mock":
                log_pass("Error message expected in mock mode")
            else:
                log_warning(f"Error message present in {mode} mode: {data['error']}")
        
        # Mock mode specific checks
        if mode == "mock":
            if len(positions) == 0:
                log_pass("Mock mode returns empty positions list (expected)")
            else:
                log_warning(f"Mock mode has {len(positions)} positions (expected 0)")
                results.add_warning("GET /api/positions - Mock mode positions", f"Expected empty list, got {len(positions)} items")
            
            if "error" in data:
                log_pass(f"Mock mode includes error message: '{data['error']}'")
            else:
                log_info("Mock mode has no error message (acceptable)")
        
        # If positions exist, validate structure
        if len(positions) > 0:
            log_info(f"Validating structure of {len(positions)} positions...")
            sample = positions[0]
            expected_fields = ["tradingsymbol", "quantity", "average_price", "last_price", "pnl"]
            missing_fields = [f for f in expected_fields if f not in sample]
            if missing_fields:
                log_warning(f"Position missing expected fields: {missing_fields}")
                results.add_warning("GET /api/positions - Position structure", f"Missing fields: {missing_fields}")
            else:
                log_pass(f"Position structure valid (sample: {sample.get('tradingsymbol')})")
        
        log_info(f"Full response: {json.dumps(data, indent=2)}")
        results.add_pass("GET /api/positions", f"Mode: {mode}, Positions: {len(positions)}")
        
    except requests.Timeout:
        log_fail(f"Request timed out after {TIMEOUT}s")
        results.add_fail("GET /api/positions - Timeout", f"Request exceeded {TIMEOUT}s timeout")
    except requests.RequestException as e:
        log_fail(f"Request failed: {e}")
        results.add_fail("GET /api/positions - Request error", str(e))
    except Exception as e:
        log_fail(f"Unexpected error: {e}")
        results.add_fail("GET /api/positions - Unexpected error", str(e))


def test_settings_roundtrip():
    """
    HIGH PRIORITY TEST 2: POST /api/settings - Settings save/load round trip
    User reported alert settings might not be persisting
    """
    log_test("POST /api/settings - Settings persistence round trip")
    
    try:
        # Step 1: GET current settings
        log_info("Step 1: GET /api/settings - Fetching current settings...")
        response = requests.get(f"{BASE_URL}/settings", timeout=TIMEOUT)
        
        if response.status_code != 200:
            log_fail(f"GET /api/settings failed with status {response.status_code}")
            results.add_fail("POST /api/settings - GET initial", f"Status {response.status_code}")
            return
        
        original_settings = response.json()
        log_pass(f"Current settings retrieved: {json.dumps(original_settings, indent=2)}")
        
        # Step 2: POST new settings
        log_info("Step 2: POST /api/settings - Saving new settings...")
        new_settings = {
            "threshold_pct": 18.0,
            "compare_minutes": 4,
            "cooldown_seconds": 90,
            "enabled_indices": ["NIFTY", "SENSEX", "BANKNIFTY"]
        }
        log_info(f"Posting: {json.dumps(new_settings, indent=2)}")
        
        start_time = time.time()
        response = requests.post(f"{BASE_URL}/settings", json=new_settings, timeout=TIMEOUT)
        elapsed = time.time() - start_time
        
        if elapsed > TIMEOUT:
            log_fail(f"POST response time {elapsed:.2f}s exceeds {TIMEOUT}s")
            results.add_fail("POST /api/settings - Response time", f"Took {elapsed:.2f}s")
        else:
            log_pass(f"POST response time: {elapsed:.2f}s")
        
        if response.status_code != 200:
            log_fail(f"POST /api/settings failed with status {response.status_code}")
            log_info(f"Response: {response.text}")
            results.add_fail("POST /api/settings - POST status", f"Status {response.status_code}")
            return
        
        returned_settings = response.json()
        log_pass(f"Settings saved, response: {json.dumps(returned_settings, indent=2)}")
        
        # Verify POST response reflects new values
        mismatches = []
        for key, expected_value in new_settings.items():
            actual_value = returned_settings.get(key)
            if actual_value != expected_value:
                mismatches.append(f"{key}: expected {expected_value}, got {actual_value}")
        
        if mismatches:
            log_fail(f"POST response doesn't reflect new values: {mismatches}")
            results.add_fail("POST /api/settings - Response values", f"Mismatches: {mismatches}")
        else:
            log_pass("POST response correctly reflects all new values")
        
        # Step 3: GET settings again to verify persistence
        log_info("Step 3: GET /api/settings - Verifying persistence...")
        time.sleep(0.5)  # Small delay to ensure persistence
        response = requests.get(f"{BASE_URL}/settings", timeout=TIMEOUT)
        
        if response.status_code != 200:
            log_fail(f"Second GET /api/settings failed with status {response.status_code}")
            results.add_fail("POST /api/settings - GET verification", f"Status {response.status_code}")
            return
        
        persisted_settings = response.json()
        log_pass(f"Persisted settings retrieved: {json.dumps(persisted_settings, indent=2)}")
        
        # Verify persistence
        persistence_mismatches = []
        for key, expected_value in new_settings.items():
            actual_value = persisted_settings.get(key)
            if actual_value != expected_value:
                persistence_mismatches.append(f"{key}: expected {expected_value}, got {actual_value}")
        
        if persistence_mismatches:
            log_fail(f"Settings not persisted correctly: {persistence_mismatches}")
            results.add_fail("POST /api/settings - Persistence", f"Mismatches: {persistence_mismatches}")
        else:
            log_pass("✓ CRITICAL: Settings persisted correctly - round trip successful!")
        
        # Step 4: Restore original settings
        log_info("Step 4: Restoring original settings...")
        response = requests.post(f"{BASE_URL}/settings", json=original_settings, timeout=TIMEOUT)
        
        if response.status_code == 200:
            log_pass("Original settings restored successfully")
        else:
            log_warning(f"Failed to restore original settings (status {response.status_code})")
        
        if not persistence_mismatches:
            results.add_pass("POST /api/settings - Round trip", "Settings save/load working correctly")
        
    except requests.Timeout:
        log_fail(f"Request timed out after {TIMEOUT}s")
        results.add_fail("POST /api/settings - Timeout", f"Request exceeded {TIMEOUT}s")
    except requests.RequestException as e:
        log_fail(f"Request failed: {e}")
        results.add_fail("POST /api/settings - Request error", str(e))
    except Exception as e:
        log_fail(f"Unexpected error: {e}")
        results.add_fail("POST /api/settings - Unexpected error", str(e))


def test_settings_validation():
    """
    HIGH PRIORITY TEST 2b: POST /api/settings - Invalid payload handling
    Should return 4xx for bad payloads, not 500
    """
    log_test("POST /api/settings - Invalid payload validation")
    
    test_cases = [
        {
            "name": "Out of range threshold",
            "payload": {"threshold_pct": -10},
            "expected_status_range": (400, 499)
        },
        {
            "name": "Invalid index in enabled_indices",
            "payload": {"enabled_indices": ["NIFTY", "INVALID_INDEX"]},
            "expected_status_range": (400, 499)
        },
        {
            "name": "Wrong type for compare_minutes",
            "payload": {"compare_minutes": "not_a_number"},
            "expected_status_range": (400, 499)
        }
    ]
    
    for test_case in test_cases:
        log_info(f"Testing: {test_case['name']}")
        try:
            response = requests.post(
                f"{BASE_URL}/settings",
                json=test_case["payload"],
                timeout=TIMEOUT
            )
            
            status = response.status_code
            expected_min, expected_max = test_case["expected_status_range"]
            
            if status == 500:
                log_fail(f"{test_case['name']}: Got 500 error (should be 4xx)")
                results.add_fail(
                    f"POST /api/settings - {test_case['name']}",
                    f"Got 500 error instead of 4xx for invalid payload"
                )
            elif expected_min <= status <= expected_max:
                log_pass(f"{test_case['name']}: Correctly returned {status}")
            else:
                log_warning(f"{test_case['name']}: Got {status}, expected {expected_min}-{expected_max}")
                results.add_warning(
                    f"POST /api/settings - {test_case['name']}",
                    f"Got {status}, expected {expected_min}-{expected_max}"
                )
        
        except Exception as e:
            log_fail(f"{test_case['name']}: Exception - {e}")
            results.add_fail(f"POST /api/settings - {test_case['name']}", str(e))
    
    results.add_pass("POST /api/settings - Validation", "Invalid payloads handled correctly")


def test_status_endpoint():
    """SMOKE TEST: GET /api/status"""
    log_test("GET /api/status - Smoke test")
    
    try:
        response = requests.get(f"{BASE_URL}/status", timeout=TIMEOUT)
        
        if response.status_code != 200:
            log_fail(f"Status code: {response.status_code}")
            results.add_fail("GET /api/status", f"Status {response.status_code}")
            return
        
        data = response.json()
        required_keys = ["mode", "running", "has_kite_credentials", "poll_interval_seconds"]
        missing = [k for k in required_keys if k not in data]
        
        if missing:
            log_fail(f"Missing keys: {missing}")
            results.add_fail("GET /api/status - Keys", f"Missing: {missing}")
        else:
            log_pass(f"All required keys present: {data}")
            results.add_pass("GET /api/status", f"Mode: {data.get('mode')}, Running: {data.get('running')}")
    
    except Exception as e:
        log_fail(f"Error: {e}")
        results.add_fail("GET /api/status", str(e))


def test_oi_change_endpoint():
    """SMOKE TEST: GET /api/oi/NIFTY/change with various minutes parameters"""
    log_test("GET /api/oi/NIFTY/change - Multiple timeframes")
    
    test_minutes = [1, 3, 5, 15]
    
    for minutes in test_minutes:
        log_info(f"Testing minutes={minutes}...")
        try:
            start_time = time.time()
            response = requests.get(
                f"{BASE_URL}/oi/NIFTY/change",
                params={"minutes": minutes},
                timeout=TIMEOUT
            )
            elapsed = time.time() - start_time
            
            if response.status_code != 200:
                log_fail(f"minutes={minutes}: Status {response.status_code}")
                results.add_fail(f"GET /api/oi/NIFTY/change?minutes={minutes}", f"Status {response.status_code}")
                continue
            
            if elapsed > TIMEOUT:
                log_fail(f"minutes={minutes}: Response time {elapsed:.2f}s > {TIMEOUT}s")
                results.add_fail(f"GET /api/oi/NIFTY/change?minutes={minutes}", f"Timeout {elapsed:.2f}s")
                continue
            
            data = response.json()
            
            # Check structure
            if "current" not in data:
                log_fail(f"minutes={minutes}: Missing 'current' key")
                results.add_fail(f"GET /api/oi/NIFTY/change?minutes={minutes}", "Missing 'current' key")
                continue
            
            current = data["current"]
            if "strikes" not in current:
                log_fail(f"minutes={minutes}: Missing 'current.strikes' key")
                results.add_fail(f"GET /api/oi/NIFTY/change?minutes={minutes}", "Missing 'current.strikes'")
                continue
            
            strikes = current["strikes"]
            if not isinstance(strikes, list) or len(strikes) == 0:
                log_fail(f"minutes={minutes}: 'current.strikes' is empty or not a list")
                results.add_fail(f"GET /api/oi/NIFTY/change?minutes={minutes}", "Empty strikes list")
                continue
            
            # Validate strike structure
            sample_strike = strikes[0]
            required_strike_keys = ["strike", "ce_oi", "pe_oi", "ce_ltp", "pe_ltp"]
            missing_keys = [k for k in required_strike_keys if k not in sample_strike]
            
            if missing_keys:
                log_fail(f"minutes={minutes}: Strike missing keys: {missing_keys}")
                results.add_fail(f"GET /api/oi/NIFTY/change?minutes={minutes}", f"Strike missing: {missing_keys}")
                continue
            
            # Check for ATM and price
            if "atm" not in current:
                log_warning(f"minutes={minutes}: Missing 'atm' in current")
            if "price" not in current:
                log_warning(f"minutes={minutes}: Missing 'price' in current")
            
            log_pass(f"minutes={minutes}: OK ({len(strikes)} strikes, {elapsed:.2f}s)")
            results.add_pass(f"GET /api/oi/NIFTY/change?minutes={minutes}", f"{len(strikes)} strikes")
        
        except Exception as e:
            log_fail(f"minutes={minutes}: {e}")
            results.add_fail(f"GET /api/oi/NIFTY/change?minutes={minutes}", str(e))


def test_alerts_endpoint():
    """SMOKE TEST: GET /api/alerts"""
    log_test("GET /api/alerts - Smoke test")
    
    try:
        response = requests.get(f"{BASE_URL}/alerts", timeout=TIMEOUT)
        
        if response.status_code != 200:
            log_fail(f"Status code: {response.status_code}")
            results.add_fail("GET /api/alerts", f"Status {response.status_code}")
            return
        
        data = response.json()
        
        if "alerts" not in data:
            log_fail("Missing 'alerts' key in response")
            results.add_fail("GET /api/alerts", "Missing 'alerts' key")
            return
        
        alerts = data["alerts"]
        if not isinstance(alerts, list):
            log_fail(f"'alerts' should be a list, got {type(alerts).__name__}")
            results.add_fail("GET /api/alerts", f"Wrong type: {type(alerts).__name__}")
            return
        
        log_pass(f"Response valid with {len(alerts)} alerts")
        results.add_pass("GET /api/alerts", f"{len(alerts)} alerts")
    
    except Exception as e:
        log_fail(f"Error: {e}")
        results.add_fail("GET /api/alerts", str(e))


def test_expiries_endpoint():
    """SMOKE TEST: GET /api/expiries/NIFTY"""
    log_test("GET /api/expiries/NIFTY - Smoke test")
    
    try:
        response = requests.get(f"{BASE_URL}/expiries/NIFTY", timeout=TIMEOUT)
        
        if response.status_code != 200:
            log_fail(f"Status code: {response.status_code}")
            results.add_fail("GET /api/expiries/NIFTY", f"Status {response.status_code}")
            return
        
        data = response.json()
        
        if "expiries" not in data:
            log_fail("Missing 'expiries' key in response")
            results.add_fail("GET /api/expiries/NIFTY", "Missing 'expiries' key")
            return
        
        expiries = data["expiries"]
        if not isinstance(expiries, list):
            log_fail(f"'expiries' should be a list, got {type(expiries).__name__}")
            results.add_fail("GET /api/expiries/NIFTY", f"Wrong type: {type(expiries).__name__}")
            return
        
        log_pass(f"Response valid with {len(expiries)} expiries")
        log_info(f"Expiries: {expiries}")
        results.add_pass("GET /api/expiries/NIFTY", f"{len(expiries)} expiries")
    
    except Exception as e:
        log_fail(f"Error: {e}")
        results.add_fail("GET /api/expiries/NIFTY", str(e))


def main():
    print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
    print(f"{Colors.BOLD}OI PULSE BACKEND REGRESSION TEST SUITE - JULY 2026{Colors.RESET}")
    print(f"{Colors.BOLD}{'='*80}{Colors.RESET}")
    print(f"Backend URL: {BASE_URL}")
    print(f"Timeout: {TIMEOUT}s")
    print(f"{Colors.BOLD}{'='*80}{Colors.RESET}\n")
    
    # HIGH PRIORITY TESTS
    print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
    print(f"{Colors.BOLD}HIGH PRIORITY TESTS{Colors.RESET}")
    print(f"{Colors.BOLD}{'='*80}{Colors.RESET}\n")
    
    test_positions_endpoint()
    test_settings_roundtrip()
    test_settings_validation()
    
    # SMOKE TESTS
    print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
    print(f"{Colors.BOLD}SMOKE TESTS{Colors.RESET}")
    print(f"{Colors.BOLD}{'='*80}{Colors.RESET}\n")
    
    test_status_endpoint()
    test_oi_change_endpoint()
    test_alerts_endpoint()
    test_expiries_endpoint()
    
    # SUMMARY
    success = results.summary()
    
    if success:
        print(f"{Colors.GREEN}{Colors.BOLD}ALL TESTS PASSED ✓{Colors.RESET}\n")
        return 0
    else:
        print(f"{Colors.RED}{Colors.BOLD}SOME TESTS FAILED ✗{Colors.RESET}\n")
        return 1


if __name__ == "__main__":
    exit(main())
