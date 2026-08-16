#!/usr/bin/env python3
"""
Backend verification for StrikLenz after production data restore + CORS hardening.
Tests admin login, CORS behavior, OI endpoints, history/alerts, and auth gating.
"""

import requests
import json
import sys

# Base URL from frontend/.env
BASE_URL = "https://b3a1e8d4-f777-4013-87ed-80bd541d1031.preview.emergentagent.com/api"

# Admin credentials from test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = "Q@w3e4r5"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"\n{status}: {name}")
    if details:
        print(f"  {details}")

def test_admin_login():
    """Test 1: POST /api/auth/login with admin credentials"""
    print("\n" + "="*80)
    print("TEST 1: Admin Login")
    print("="*80)
    
    url = f"{BASE_URL}/auth/login"
    payload = {
        "username": ADMIN_USERNAME,
        "password": ADMIN_PASSWORD
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:500]}")
        
        if response.status_code == 200:
            data = response.json()
            has_token = "token" in data
            is_admin = data.get("is_admin") == True
            
            print(f"  - Has token: {has_token}")
            print(f"  - is_admin: {data.get('is_admin')}")
            
            if has_token and is_admin:
                print_test("Admin Login", True, f"Token received, is_admin=true")
                return True, data.get("token")
            else:
                print_test("Admin Login", False, f"Missing token or is_admin not true")
                return False, None
        else:
            print_test("Admin Login", False, f"Expected 200, got {response.status_code}")
            return False, None
            
    except Exception as e:
        print_test("Admin Login", False, f"Exception: {str(e)}")
        return False, None

def test_cors():
    """Test 2: CORS with different origins"""
    print("\n" + "="*80)
    print("TEST 2: CORS Verification")
    print("="*80)
    
    origins = [
        "https://striklenz.com",
        "https://strike-preview-1.emergent.host"
    ]
    
    all_passed = True
    
    for origin in origins:
        print(f"\n--- Testing Origin: {origin} ---")
        
        # Test OPTIONS preflight
        print("\nOPTIONS /api/status (preflight):")
        try:
            response = requests.options(
                f"{BASE_URL}/status",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "content-type"
                },
                timeout=10
            )
            print(f"  Status: {response.status_code}")
            print(f"  Headers: {dict(response.headers)}")
            
            has_allow_origin = "Access-Control-Allow-Origin" in response.headers
            has_credentials = "Access-Control-Allow-Credentials" in response.headers
            credentials_value = response.headers.get("Access-Control-Allow-Credentials", "").lower()
            
            print(f"  - Access-Control-Allow-Origin present: {has_allow_origin}")
            print(f"  - Access-Control-Allow-Credentials: {credentials_value if has_credentials else 'NOT PRESENT'}")
            
            # Check for wildcard + credentials conflict
            allow_origin = response.headers.get("Access-Control-Allow-Origin", "")
            has_conflict = (allow_origin == "*" and credentials_value == "true")
            
            if has_conflict:
                print_test(f"CORS OPTIONS {origin}", False, "CONFLICT: wildcard origin with credentials=true")
                all_passed = False
            elif has_allow_origin:
                print_test(f"CORS OPTIONS {origin}", True, f"Allow-Origin: {allow_origin}, no conflict")
            else:
                print_test(f"CORS OPTIONS {origin}", False, "Missing Access-Control-Allow-Origin")
                all_passed = False
                
        except Exception as e:
            print_test(f"CORS OPTIONS {origin}", False, f"Exception: {str(e)}")
            all_passed = False
        
        # Test actual GET request
        print(f"\nGET /api/status:")
        try:
            response = requests.get(
                f"{BASE_URL}/status",
                headers={"Origin": origin},
                timeout=10
            )
            print(f"  Status: {response.status_code}")
            print(f"  Response: {response.text[:200]}")
            
            has_allow_origin = "Access-Control-Allow-Origin" in response.headers
            has_credentials = "Access-Control-Allow-Credentials" in response.headers
            credentials_value = response.headers.get("Access-Control-Allow-Credentials", "").lower()
            
            print(f"  - Access-Control-Allow-Origin: {response.headers.get('Access-Control-Allow-Origin', 'NOT PRESENT')}")
            print(f"  - Access-Control-Allow-Credentials: {credentials_value if has_credentials else 'NOT PRESENT'}")
            
            # Check for wildcard + credentials conflict
            allow_origin = response.headers.get("Access-Control-Allow-Origin", "")
            has_conflict = (allow_origin == "*" and credentials_value == "true")
            
            if response.status_code == 200:
                if has_conflict:
                    print_test(f"CORS GET {origin}", False, "CONFLICT: wildcard origin with credentials=true")
                    all_passed = False
                elif has_allow_origin:
                    print_test(f"CORS GET {origin}", True, f"Allow-Origin: {allow_origin}, no conflict")
                else:
                    print_test(f"CORS GET {origin}", False, "Missing Access-Control-Allow-Origin")
                    all_passed = False
            else:
                print_test(f"CORS GET {origin}", False, f"Expected 200, got {response.status_code}")
                all_passed = False
                
        except Exception as e:
            print_test(f"CORS GET {origin}", False, f"Exception: {str(e)}")
            all_passed = False
    
    return all_passed

def test_oi_endpoints():
    """Test 3: GET /api/oi/{index} for NIFTY, SENSEX, BANKNIFTY"""
    print("\n" + "="*80)
    print("TEST 3: OI Endpoints (Restored Data)")
    print("="*80)
    
    indices = ["NIFTY", "SENSEX", "BANKNIFTY"]
    all_passed = True
    
    for index in indices:
        print(f"\n--- Testing /api/oi/{index} ---")
        try:
            response = requests.get(f"{BASE_URL}/oi/{index}", timeout=10)
            print(f"Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Response keys: {list(data.keys())}")
                
                has_price = "price" in data and data["price"] is not None
                has_atm = "atm" in data and data["atm"] is not None
                has_strikes = "strikes" in data and isinstance(data["strikes"], list) and len(data["strikes"]) > 0
                has_pcr = "pcr" in data and data["pcr"] is not None
                
                print(f"  - price: {data.get('price')} (present: {has_price})")
                print(f"  - atm: {data.get('atm')} (present: {has_atm})")
                print(f"  - strikes count: {len(data.get('strikes', []))} (present: {has_strikes})")
                print(f"  - pcr: {data.get('pcr')} (present: {has_pcr})")
                
                if has_price and has_atm and has_strikes and has_pcr:
                    print_test(f"OI {index}", True, f"All fields present with data")
                else:
                    missing = []
                    if not has_price: missing.append("price")
                    if not has_atm: missing.append("atm")
                    if not has_strikes: missing.append("strikes")
                    if not has_pcr: missing.append("pcr")
                    print_test(f"OI {index}", False, f"Missing or null: {', '.join(missing)}")
                    all_passed = False
            else:
                print(f"Response: {response.text[:200]}")
                print_test(f"OI {index}", False, f"Expected 200, got {response.status_code}")
                all_passed = False
                
        except Exception as e:
            print_test(f"OI {index}", False, f"Exception: {str(e)}")
            all_passed = False
    
    return all_passed

def test_history_and_alerts():
    """Test 4: GET /api/history/NIFTY and GET /api/alerts"""
    print("\n" + "="*80)
    print("TEST 4: History and Alerts (Restored Data)")
    print("="*80)
    
    all_passed = True
    
    # Test history
    print("\n--- Testing /api/history/NIFTY ---")
    try:
        response = requests.get(f"{BASE_URL}/history/NIFTY", timeout=10)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Response type: {type(data)}")
            
            # Check if it's a non-empty list/array
            if isinstance(data, list):
                print(f"History entries count: {len(data)}")
                if len(data) > 0:
                    print(f"Sample entry: {json.dumps(data[0], indent=2)[:200]}")
                    print_test("History NIFTY", True, f"Returned {len(data)} history entries")
                else:
                    print_test("History NIFTY", False, "Empty history array")
                    all_passed = False
            elif isinstance(data, dict) and "history" in data:
                history = data.get("history", [])
                count = data.get("count", 0)
                print(f"History count: {count}, entries: {len(history)}")
                if len(history) > 0:
                    print(f"Sample entry: {json.dumps(history[0], indent=2)[:200]}")
                    print_test("History NIFTY", True, f"Returned {len(history)} history entries (count={count})")
                else:
                    print_test("History NIFTY", False, "Empty history")
                    all_passed = False
            elif isinstance(data, dict) and "series" in data:
                series = data.get("series", [])
                print(f"History series count: {len(series)}")
                if len(series) > 0:
                    print_test("History NIFTY", True, f"Returned {len(series)} series entries")
                else:
                    print_test("History NIFTY", False, "Empty series")
                    all_passed = False
            else:
                print(f"Unexpected response structure: {str(data)[:200]}")
                print_test("History NIFTY", False, "Unexpected response structure")
                all_passed = False
        else:
            print(f"Response: {response.text[:200]}")
            print_test("History NIFTY", False, f"Expected 200, got {response.status_code}")
            all_passed = False
            
    except Exception as e:
        print_test("History NIFTY", False, f"Exception: {str(e)}")
        all_passed = False
    
    # Test alerts
    print("\n--- Testing /api/alerts ---")
    try:
        response = requests.get(f"{BASE_URL}/alerts", timeout=10)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Response type: {type(data)}")
            
            if isinstance(data, list):
                print(f"Alerts count: {len(data)}")
                if len(data) > 0:
                    print(f"Sample alert: {json.dumps(data[0], indent=2)[:200]}")
                    print_test("Alerts", True, f"Returned {len(data)} alerts (expected ~17)")
                else:
                    print_test("Alerts", False, "Empty alerts array")
                    all_passed = False
            elif isinstance(data, dict) and "alerts" in data:
                alerts = data.get("alerts", [])
                print(f"Alerts count: {len(alerts)}")
                if len(alerts) > 0:
                    print_test("Alerts", True, f"Returned {len(alerts)} alerts (expected ~17)")
                else:
                    print_test("Alerts", False, "Empty alerts")
                    all_passed = False
            else:
                print(f"Unexpected response structure: {str(data)[:200]}")
                print_test("Alerts", False, "Unexpected response structure")
                all_passed = False
        else:
            print(f"Response: {response.text[:200]}")
            print_test("Alerts", False, f"Expected 200, got {response.status_code}")
            all_passed = False
            
    except Exception as e:
        print_test("Alerts", False, f"Exception: {str(e)}")
        all_passed = False
    
    return all_passed

def test_admin_gating():
    """Test 5: Admin-gated endpoint rejects unauthenticated requests"""
    print("\n" + "="*80)
    print("TEST 5: Admin Gating (Unauthenticated Request)")
    print("="*80)
    
    print("\n--- Testing POST /api/settings without token ---")
    try:
        response = requests.post(
            f"{BASE_URL}/settings",
            json={"test": "data"},
            timeout=10
        )
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 401:
            print_test("Admin Gating", True, "Correctly rejected with 401")
            return True
        else:
            print_test("Admin Gating", False, f"Expected 401, got {response.status_code}")
            return False
            
    except Exception as e:
        print_test("Admin Gating", False, f"Exception: {str(e)}")
        return False

def main():
    print("="*80)
    print("StrikLenz Backend Verification")
    print("After Production Data Restore + CORS Hardening")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Admin User: {ADMIN_USERNAME}")
    print("="*80)
    
    results = {}
    
    # Test 1: Admin Login
    login_passed, token = test_admin_login()
    results["Admin Login"] = login_passed
    
    # Test 2: CORS
    cors_passed = test_cors()
    results["CORS"] = cors_passed
    
    # Test 3: OI Endpoints
    oi_passed = test_oi_endpoints()
    results["OI Endpoints"] = oi_passed
    
    # Test 4: History and Alerts
    history_passed = test_history_and_alerts()
    results["History & Alerts"] = history_passed
    
    # Test 5: Admin Gating
    gating_passed = test_admin_gating()
    results["Admin Gating"] = gating_passed
    
    # Summary
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    total = len(results)
    passed_count = sum(1 for p in results.values() if p)
    
    print(f"\nTotal: {passed_count}/{total} tests passed")
    
    if passed_count == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️  {total - passed_count} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
