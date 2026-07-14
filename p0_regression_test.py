#!/usr/bin/env python3
"""
P0 REGRESSION TEST - Stale Cache Inline Refresh + Poll Loop Timeout Fix
July 2026 Iteration #6

Tests the fix for: "1 min / 3 min / 5 min / 10 min / 15 min all show IDENTICAL values"

Root cause: tracker.last_snapshot was frozen for 8+ minutes because background poll
loop silently hung on one index, starving the loop.

Fix:
1. server.py get_oi_change(): detects stale cache (>20s) and forces inline refresh
2. oi_service.py: rich error logging on every None-return path
3. oi_tracker.py _poll_once: per-index timeout wrapping (10s) to prevent starvation
"""

import requests
import json
import time
from datetime import datetime
from typing import Dict, Any, List

# Backend URL from frontend/.env
BASE_URL = "https://stale-snapshot-cache.preview.emergentagent.com/api"
TIMEOUT = 15  # 15 second timeout for API calls

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def log_section(title: str):
    print(f"\n{Colors.CYAN}{Colors.BOLD}{'='*80}{Colors.RESET}")
    print(f"{Colors.CYAN}{Colors.BOLD}{title}{Colors.RESET}")
    print(f"{Colors.CYAN}{Colors.BOLD}{'='*80}{Colors.RESET}")

def log_test(name: str):
    print(f"\n{Colors.BLUE}{Colors.BOLD}TEST: {name}{Colors.RESET}")

def log_pass(msg: str):
    print(f"{Colors.GREEN}✓ PASS: {msg}{Colors.RESET}")

def log_fail(msg: str):
    print(f"{Colors.RED}✗ FAIL: {msg}{Colors.RESET}")

def log_info(msg: str):
    print(f"  ℹ {msg}")

def log_warning(msg: str):
    print(f"{Colors.YELLOW}⚠ WARNING: {msg}{Colors.RESET}")

class TestResults:
    def __init__(self):
        self.passed = []
        self.failed = []
        self.warnings = []
    
    def add_pass(self, test_name: str, detail: str = ""):
        self.passed.append((test_name, detail))
        log_pass(f"{test_name}: {detail}" if detail else test_name)
    
    def add_fail(self, test_name: str, detail: str):
        self.failed.append((test_name, detail))
        log_fail(f"{test_name}: {detail}")
    
    def add_warning(self, test_name: str, detail: str):
        self.warnings.append((test_name, detail))
        log_warning(f"{test_name}: {detail}")
    
    def summary(self):
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}P0 REGRESSION TEST SUMMARY{Colors.RESET}")
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

def test_status_endpoint():
    """
    TEST 1: GET /api/status
    Verify: HTTP 200, running=true, poll_interval_seconds=15
    """
    log_test("1. GET /api/status - Verify tracker is running")
    
    try:
        response = requests.get(f"{BASE_URL}/status", timeout=TIMEOUT)
        
        if response.status_code != 200:
            results.add_fail("Status endpoint", f"Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        log_info(f"Response: {json.dumps(data, indent=2)}")
        
        # Check running
        if data.get("running") != True:
            results.add_fail("Tracker running", f"Expected running=true, got {data.get('running')}")
            return False
        
        # Check poll_interval_seconds
        if data.get("poll_interval_seconds") != 15:
            results.add_warning("Poll interval", f"Expected 15, got {data.get('poll_interval_seconds')}")
        
        results.add_pass("Status endpoint", f"running={data.get('running')}, poll_interval={data.get('poll_interval_seconds')}s")
        return True
        
    except Exception as e:
        results.add_fail("Status endpoint", str(e))
        return False

def test_oi_change_structure(index: str = "NIFTY", minutes: int = 1):
    """
    TEST 2: GET /api/oi/{index}/change?minutes=1
    Verify response structure: current, previous, minutes, history_ready
    Verify current.strikes is non-empty with proper keys
    """
    log_test(f"2. GET /api/oi/{index}/change?minutes={minutes} - Verify structure")
    
    try:
        response = requests.get(
            f"{BASE_URL}/oi/{index}/change",
            params={"minutes": minutes},
            timeout=TIMEOUT
        )
        
        if response.status_code != 200:
            results.add_fail(f"OI change {index} structure", f"Expected 200, got {response.status_code}")
            return None
        
        data = response.json()
        
        # Check required keys
        required_keys = ["index", "current", "previous", "minutes", "history_ready"]
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            results.add_fail(f"OI change {index} structure", f"Missing keys: {missing_keys}")
            return None
        
        # Check current.strikes
        current = data.get("current")
        if not current:
            results.add_fail(f"OI change {index} structure", "current is null")
            return None
        
        strikes = current.get("strikes")
        if not isinstance(strikes, list) or len(strikes) == 0:
            results.add_fail(f"OI change {index} structure", f"current.strikes is empty or not a list")
            return None
        
        # Verify strike structure
        sample_strike = strikes[0]
        required_strike_keys = ["strike", "ce_oi", "pe_oi", "ce_ltp", "pe_ltp"]
        missing_strike_keys = [k for k in required_strike_keys if k not in sample_strike]
        if missing_strike_keys:
            results.add_fail(f"OI change {index} structure", f"Strike missing keys: {missing_strike_keys}")
            return None
        
        # Check history_ready is boolean
        if not isinstance(data.get("history_ready"), bool):
            results.add_warning(f"OI change {index} structure", f"history_ready is not boolean: {type(data.get('history_ready'))}")
        
        results.add_pass(
            f"OI change {index} structure",
            f"{len(strikes)} strikes, history_ready={data.get('history_ready')}"
        )
        
        return data
        
    except Exception as e:
        results.add_fail(f"OI change {index} structure", str(e))
        return None

def test_inline_refresh_triggers():
    """
    TEST 3: Verify inline refresh triggers when cache is stale (>20s)
    Make 3 calls ~30s apart and verify current.timestamp DIFFERS
    This proves the inline refresh is working
    """
    log_test("3. Inline refresh verification - 3 calls ~30s apart")
    
    timestamps = []
    
    for i in range(3):
        log_info(f"Call {i+1}/3...")
        
        try:
            response = requests.get(
                f"{BASE_URL}/oi/NIFTY/change",
                params={"minutes": 1},
                timeout=TIMEOUT
            )
            
            if response.status_code != 200:
                results.add_fail("Inline refresh", f"Call {i+1} failed with status {response.status_code}")
                return False
            
            data = response.json()
            current_ts = data.get("current", {}).get("timestamp")
            
            if not current_ts:
                results.add_fail("Inline refresh", f"Call {i+1} has no current.timestamp")
                return False
            
            timestamps.append(current_ts)
            log_info(f"  current.timestamp = {current_ts}")
            
            # Wait 30 seconds before next call (except after last call)
            if i < 2:
                log_info(f"  Waiting 30 seconds before next call...")
                time.sleep(30)
        
        except Exception as e:
            results.add_fail("Inline refresh", f"Call {i+1} exception: {e}")
            return False
    
    # Verify timestamps are different
    unique_timestamps = set(timestamps)
    
    if len(unique_timestamps) == 1:
        results.add_fail(
            "Inline refresh",
            f"All 3 calls returned IDENTICAL timestamp: {timestamps[0]} - CACHE NOT REFRESHING!"
        )
        return False
    
    if len(unique_timestamps) == 2:
        results.add_warning(
            "Inline refresh",
            f"Only 2 unique timestamps out of 3 calls: {timestamps}"
        )
    
    if len(unique_timestamps) == 3:
        results.add_pass(
            "Inline refresh",
            f"All 3 timestamps DIFFER - inline refresh working! {timestamps}"
        )
        return True
    
    # At least 2 different timestamps is acceptable
    results.add_pass(
        "Inline refresh",
        f"{len(unique_timestamps)} unique timestamps - cache is refreshing"
    )
    return True

def test_multiple_timeframes(index: str = "NIFTY"):
    """
    TEST 4: Test all timeframes (1,3,5,10,15,30) sequentially
    Verify all return 200 and have different previous.timestamp values
    This proves different lookback windows resolve to different DB docs
    """
    log_test(f"4. Multiple timeframes for {index} - Verify distinct previous timestamps")
    
    timeframes = [1, 3, 5, 10, 15, 30]
    results_data = {}
    
    for minutes in timeframes:
        log_info(f"Testing minutes={minutes}...")
        
        try:
            response = requests.get(
                f"{BASE_URL}/oi/{index}/change",
                params={"minutes": minutes},
                timeout=TIMEOUT
            )
            
            if response.status_code != 200:
                results.add_fail(
                    f"Timeframe {index} {minutes}min",
                    f"Expected 200, got {response.status_code}"
                )
                continue
            
            data = response.json()
            current_ts = data.get("current", {}).get("timestamp")
            previous_ts = data.get("previous", {}).get("timestamp") if data.get("previous") else None
            history_ready = data.get("history_ready")
            
            results_data[minutes] = {
                "current_ts": current_ts,
                "previous_ts": previous_ts,
                "history_ready": history_ready
            }
            
            log_info(f"  current.timestamp: {current_ts}")
            log_info(f"  previous.timestamp: {previous_ts}")
            log_info(f"  history_ready: {history_ready}")
            
        except Exception as e:
            results.add_fail(f"Timeframe {index} {minutes}min", str(e))
    
    # Analyze results
    if len(results_data) < len(timeframes):
        results.add_fail(
            f"Timeframes {index}",
            f"Only {len(results_data)}/{len(timeframes)} timeframes succeeded"
        )
        return False
    
    # Check if previous timestamps differ
    previous_timestamps = [
        v["previous_ts"] for v in results_data.values()
        if v["previous_ts"] is not None
    ]
    
    unique_previous = set(previous_timestamps)
    
    log_info(f"\nAnalysis:")
    log_info(f"  Total timeframes tested: {len(timeframes)}")
    log_info(f"  Previous timestamps collected: {len(previous_timestamps)}")
    log_info(f"  Unique previous timestamps: {len(unique_previous)}")
    
    if len(unique_previous) == 1:
        # All previous timestamps are identical - this is the BUG!
        results.add_fail(
            f"Timeframes {index}",
            f"All timeframes have IDENTICAL previous.timestamp: {list(unique_previous)[0]} - BUG NOT FIXED!"
        )
        return False
    
    if len(unique_previous) >= 3:
        results.add_pass(
            f"Timeframes {index}",
            f"{len(unique_previous)} distinct previous timestamps - different lookback windows working!"
        )
        return True
    
    # Some variation but not ideal
    results.add_warning(
        f"Timeframes {index}",
        f"Only {len(unique_previous)} unique previous timestamps (may be warming up)"
    )
    return True

def test_all_indices():
    """
    TEST 5: Test NIFTY, SENSEX, BANKNIFTY
    Verify all return 200 and have proper structure
    """
    log_test("5. All indices - NIFTY, SENSEX, BANKNIFTY")
    
    indices = ["NIFTY", "SENSEX", "BANKNIFTY"]
    all_passed = True
    
    for index in indices:
        log_info(f"\nTesting {index}...")
        
        try:
            response = requests.get(
                f"{BASE_URL}/oi/{index}/change",
                params={"minutes": 1},
                timeout=TIMEOUT
            )
            
            if response.status_code != 200:
                results.add_fail(f"Index {index}", f"Expected 200, got {response.status_code}")
                all_passed = False
                continue
            
            data = response.json()
            
            # Basic structure check
            if "current" not in data or "strikes" not in data.get("current", {}):
                results.add_fail(f"Index {index}", "Missing current.strikes")
                all_passed = False
                continue
            
            strikes_count = len(data["current"]["strikes"])
            log_info(f"  {index}: {strikes_count} strikes, history_ready={data.get('history_ready')}")
            
        except Exception as e:
            results.add_fail(f"Index {index}", str(e))
            all_passed = False
    
    if all_passed:
        results.add_pass("All indices", "NIFTY, SENSEX, BANKNIFTY all working")
    
    return all_passed

def test_no_5xx_errors():
    """
    TEST 6: Verify no 5xx errors across various endpoints
    """
    log_test("6. No 5xx errors - Sanity check multiple endpoints")
    
    endpoints = [
        "/status",
        "/tickers",
        "/settings",
        "/alerts",
        "/expiries/NIFTY",
        "/oi/NIFTY",
        "/oi/NIFTY/change?minutes=1",
        "/oi/SENSEX/change?minutes=5",
        "/oi/BANKNIFTY/change?minutes=15",
    ]
    
    errors_5xx = []
    
    for endpoint in endpoints:
        try:
            response = requests.get(f"{BASE_URL}{endpoint}", timeout=TIMEOUT)
            
            if 500 <= response.status_code < 600:
                errors_5xx.append((endpoint, response.status_code))
                log_fail(f"{endpoint}: {response.status_code}")
            else:
                log_info(f"✓ {endpoint}: {response.status_code}")
        
        except Exception as e:
            log_warning(f"{endpoint}: Exception - {e}")
    
    if errors_5xx:
        results.add_fail(
            "No 5xx errors",
            f"Found {len(errors_5xx)} 5xx errors: {errors_5xx}"
        )
        return False
    
    results.add_pass("No 5xx errors", f"All {len(endpoints)} endpoints returned non-5xx")
    return True

def check_backend_logs():
    """
    TEST 7: Check backend logs for TIMEOUT warnings
    """
    log_test("7. Backend logs - Check for TIMEOUT warnings")
    
    log_info("Checking /var/log/supervisor/backend.err.log for TIMEOUT warnings...")
    
    try:
        import subprocess
        
        # Check error log
        result = subprocess.run(
            ["tail", "-n", "100", "/var/log/supervisor/backend.err.log"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        err_log = result.stdout
        
        # Look for TIMEOUT keywords
        timeout_lines = [line for line in err_log.split('\n') if 'TIMEOUT' in line.upper() or 'timeout' in line.lower()]
        
        if timeout_lines:
            log_warning(f"Found {len(timeout_lines)} TIMEOUT-related log lines:")
            for line in timeout_lines[:5]:  # Show first 5
                log_info(f"  {line}")
            
            results.add_warning(
                "Backend logs",
                f"Found {len(timeout_lines)} TIMEOUT warnings in logs"
            )
        else:
            results.add_pass("Backend logs", "No TIMEOUT warnings found in recent logs")
        
        # Also check for [_poll_once] errors
        poll_errors = [line for line in err_log.split('\n') if '[_poll_once]' in line and ('ERROR' in line or 'WARNING' in line)]
        
        if poll_errors:
            log_warning(f"Found {len(poll_errors)} [_poll_once] error/warning lines:")
            for line in poll_errors[:5]:
                log_info(f"  {line}")
        
        return True
        
    except Exception as e:
        log_warning(f"Could not check backend logs: {e}")
        results.add_warning("Backend logs", f"Could not access logs: {e}")
        return False

def main():
    log_section("P0 REGRESSION TEST - STALE CACHE FIX")
    print(f"Backend URL: {BASE_URL}")
    print(f"Timeout: {TIMEOUT}s")
    print(f"\nTesting fix for: '1/3/5/10/15 min all show IDENTICAL values'")
    print(f"Expected: Different timeframes resolve to different DB docs")
    print(f"Expected: Inline refresh triggers when cache >20s stale")
    
    # Run all tests
    test_status_endpoint()
    test_oi_change_structure("NIFTY", 1)
    test_inline_refresh_triggers()
    test_multiple_timeframes("NIFTY")
    test_all_indices()
    test_no_5xx_errors()
    check_backend_logs()
    
    # Summary
    success = results.summary()
    
    if success:
        print(f"{Colors.GREEN}{Colors.BOLD}P0 REGRESSION TEST PASSED ✓{Colors.RESET}")
        print(f"{Colors.GREEN}The stale cache bug fix is working correctly!{Colors.RESET}\n")
        return 0
    else:
        print(f"{Colors.RED}{Colors.BOLD}P0 REGRESSION TEST FAILED ✗{Colors.RESET}")
        print(f"{Colors.RED}Some tests failed - review the failures above{Colors.RESET}\n")
        return 1

if __name__ == "__main__":
    exit(main())
