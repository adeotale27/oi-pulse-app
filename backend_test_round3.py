#!/usr/bin/env python3
"""
OI-Pulse Backend Testing Suite - Round 3
Tests the two tasks from test_result.md (2026-07-17):
1. GET /api/expiries/{index} returns W/M tagged expiries_meta
2. current.pcr still present in /api/oi/{index}/change
"""

import requests
import sys
from typing import Dict, Any, List

# Backend URL from review request
BASE_URL = "https://strike-preview-1.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test counters
tests_passed = 0
tests_failed = 0

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

def test_expiries_endpoint(index: str):
    """
    Test GET /api/expiries/{index} returns W/M tagged expiries_meta
    
    Requirements:
    - Response has `expiries` (list of ISO date strings, non-empty)
    - Response has `expiries_meta` (list of dicts) with SAME length as `expiries`
    - Each item in expiries_meta has: date, tag, type, days_to_expiry, label
    - At least ONE item has tag == "M" and at least ONE has tag == "W"
    - Dates in expiries_meta match dates in expiries exactly
    """
    test_name = f"GET /api/expiries/{index}"
    
    try:
        response = requests.get(f"{API_BASE}/expiries/{index}", timeout=10)
        
        # Check status code
        if response.status_code != 200:
            log_test(test_name, False, f"Expected 200, got {response.status_code}: {response.text}")
            return False
        
        data = response.json()
        
        # Check `expiries` field exists and is non-empty list
        if "expiries" not in data:
            log_test(test_name, False, "Missing 'expiries' field in response")
            return False
        
        expiries = data["expiries"]
        if not isinstance(expiries, list) or len(expiries) == 0:
            log_test(test_name, False, f"'expiries' must be non-empty list, got: {type(expiries)} with length {len(expiries) if isinstance(expiries, list) else 'N/A'}")
            return False
        
        # Check `expiries_meta` field exists and is list
        if "expiries_meta" not in data:
            log_test(test_name, False, "Missing 'expiries_meta' field in response")
            return False
        
        expiries_meta = data["expiries_meta"]
        if not isinstance(expiries_meta, list):
            log_test(test_name, False, f"'expiries_meta' must be list, got: {type(expiries_meta)}")
            return False
        
        # Check same length
        if len(expiries) != len(expiries_meta):
            log_test(test_name, False, f"Length mismatch: expiries={len(expiries)}, expiries_meta={len(expiries_meta)}")
            return False
        
        # Check each item in expiries_meta has required keys
        required_keys = ["date", "tag", "type", "days_to_expiry", "label"]
        has_w_tag = False
        has_m_tag = False
        
        for i, meta in enumerate(expiries_meta):
            if not isinstance(meta, dict):
                log_test(test_name, False, f"expiries_meta[{i}] must be dict, got: {type(meta)}")
                return False
            
            # Check required keys
            missing_keys = [k for k in required_keys if k not in meta]
            if missing_keys:
                log_test(test_name, False, f"expiries_meta[{i}] missing keys: {missing_keys}")
                return False
            
            # Validate types
            if not isinstance(meta["date"], str):
                log_test(test_name, False, f"expiries_meta[{i}].date must be str, got: {type(meta['date'])}")
                return False
            
            if meta["tag"] not in ["W", "M"]:
                log_test(test_name, False, f"expiries_meta[{i}].tag must be 'W' or 'M', got: {meta['tag']}")
                return False
            
            if meta["type"] not in ["weekly", "monthly"]:
                log_test(test_name, False, f"expiries_meta[{i}].type must be 'weekly' or 'monthly', got: {meta['type']}")
                return False
            
            if not isinstance(meta["days_to_expiry"], int):
                log_test(test_name, False, f"expiries_meta[{i}].days_to_expiry must be int, got: {type(meta['days_to_expiry'])}")
                return False
            
            if not isinstance(meta["label"], str):
                log_test(test_name, False, f"expiries_meta[{i}].label must be str, got: {type(meta['label'])}")
                return False
            
            # Track W/M tags
            if meta["tag"] == "W":
                has_w_tag = True
            if meta["tag"] == "M":
                has_m_tag = True
            
            # Check date matches expiries[i]
            if meta["date"] != expiries[i]:
                log_test(test_name, False, f"Date mismatch at index {i}: expiries[{i}]='{expiries[i]}', expiries_meta[{i}].date='{meta['date']}'")
                return False
        
        # Check at least one W and one M tag
        if not has_w_tag:
            log_test(test_name, False, "No 'W' (weekly) tag found in expiries_meta")
            return False
        
        if not has_m_tag:
            log_test(test_name, False, "No 'M' (monthly) tag found in expiries_meta")
            return False
        
        # All checks passed
        w_count = sum(1 for m in expiries_meta if m["tag"] == "W")
        m_count = sum(1 for m in expiries_meta if m["tag"] == "M")
        log_test(test_name, True, f"expiries={len(expiries)}, expiries_meta={len(expiries_meta)}, W={w_count}, M={m_count}")
        return True
        
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")
        return False

def test_oi_change_pcr():
    """
    Test GET /api/oi/NIFTY/change?minutes=15
    
    Requirements:
    - HTTP 200
    - response.current.pcr is a number > 0
    - response.current.atm > 0
    - response.current.price > 0
    """
    test_name = "GET /api/oi/NIFTY/change?minutes=15 (PCR check)"
    
    try:
        response = requests.get(f"{API_BASE}/oi/NIFTY/change?minutes=15", timeout=10)
        
        # Check status code
        if response.status_code != 200:
            log_test(test_name, False, f"Expected 200, got {response.status_code}: {response.text}")
            return False
        
        data = response.json()
        
        # Check `current` field exists
        if "current" not in data:
            log_test(test_name, False, "Missing 'current' field in response")
            return False
        
        current = data["current"]
        if not isinstance(current, dict):
            log_test(test_name, False, f"'current' must be dict, got: {type(current)}")
            return False
        
        # Check current.pcr exists and is number > 0
        if "pcr" not in current:
            log_test(test_name, False, "Missing 'current.pcr' field")
            return False
        
        pcr = current["pcr"]
        if not isinstance(pcr, (int, float)):
            log_test(test_name, False, f"current.pcr must be number, got: {type(pcr)}")
            return False
        
        if pcr <= 0:
            log_test(test_name, False, f"current.pcr must be > 0, got: {pcr}")
            return False
        
        # Check current.atm exists and is > 0
        if "atm" not in current:
            log_test(test_name, False, "Missing 'current.atm' field")
            return False
        
        atm = current["atm"]
        if not isinstance(atm, (int, float)):
            log_test(test_name, False, f"current.atm must be number, got: {type(atm)}")
            return False
        
        if atm <= 0:
            log_test(test_name, False, f"current.atm must be > 0, got: {atm}")
            return False
        
        # Check current.price exists and is > 0
        if "price" not in current:
            log_test(test_name, False, "Missing 'current.price' field")
            return False
        
        price = current["price"]
        if not isinstance(price, (int, float)):
            log_test(test_name, False, f"current.price must be number, got: {type(price)}")
            return False
        
        if price <= 0:
            log_test(test_name, False, f"current.price must be > 0, got: {price}")
            return False
        
        # All checks passed
        log_test(test_name, True, f"pcr={pcr:.4f}, atm={atm}, price={price}")
        return True
        
    except Exception as e:
        log_test(test_name, False, f"Exception: {str(e)}")
        return False

def main():
    """Run all tests"""
    print("=" * 80)
    print("OI-PULSE BACKEND TEST SUITE - ROUND 3")
    print("=" * 80)
    print(f"Backend URL: {BASE_URL}")
    print(f"API Base: {API_BASE}")
    print("=" * 80)
    print()
    
    # ========================================
    # TASK 1: GET /api/expiries/{index} W/M tags
    # ========================================
    print("TASK 1: GET /api/expiries/{index} returns W/M tagged expiries_meta")
    print("-" * 80)
    
    indices = ["NIFTY", "SENSEX", "BANKNIFTY"]
    task1_passed = True
    
    for index in indices:
        if not test_expiries_endpoint(index):
            task1_passed = False
    
    # ========================================
    # TASK 2: current.pcr in /api/oi/{index}/change
    # ========================================
    print("TASK 2: current.pcr still present in /api/oi/NIFTY/change")
    print("-" * 80)
    
    task2_passed = test_oi_change_pcr()
    
    # ========================================
    # SUMMARY
    # ========================================
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total tests: {tests_passed + tests_failed}")
    print(f"✅ Passed: {tests_passed}")
    print(f"❌ Failed: {tests_failed}")
    print("=" * 80)
    print()
    
    # Task-level summary
    print("TASK-LEVEL RESULTS:")
    print(f"  Task 1 (expiries W/M tags): {'✅ PASS' if task1_passed else '❌ FAIL'}")
    print(f"  Task 2 (PCR in OI change): {'✅ PASS' if task2_passed else '❌ FAIL'}")
    print("=" * 80)
    
    if tests_failed > 0:
        print("\n⚠️  SOME TESTS FAILED")
        sys.exit(1)
    else:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)

if __name__ == "__main__":
    main()
