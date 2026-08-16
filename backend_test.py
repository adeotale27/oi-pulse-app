#!/usr/bin/env python3
"""
Backend verification test for StrikLenz after DB consolidation to oi_pulse + CORS hardening + Telegram token addition.
DO NOT trigger Telegram send endpoints.
"""

import requests
import json
import sys

# Base URL from frontend/.env REACT_APP_BACKEND_URL with /api prefix
BASE_URL = "https://b3a1e8d4-f777-4013-87ed-80bd541d1031.preview.emergentagent.com/api"

# Admin credentials from test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = "Q@w3e4r5"

def print_test(test_name):
    print(f"\n{'='*80}")
    print(f"TEST: {test_name}")
    print('='*80)

def print_pass(message):
    print(f"✅ PASS: {message}")

def print_fail(message):
    print(f"❌ FAIL: {message}")

def print_info(message):
    print(f"ℹ️  INFO: {message}")

def test_1_backend_up():
    """Test 1: Backend is up (boots clean reading DB_NAME=oi_pulse). GET /api/status returns 200."""
    print_test("1. Backend is up and GET /api/status returns 200")
    
    try:
        response = requests.get(f"{BASE_URL}/status", timeout=10)
        print_info(f"Status Code: {response.status_code}")
        print_info(f"Response: {json.dumps(response.json(), indent=2)}")
        
        if response.status_code == 200:
            print_pass("Backend is up and /api/status returns 200")
            return True
        else:
            print_fail(f"Expected 200, got {response.status_code}")
            return False
    except Exception as e:
        print_fail(f"Exception: {e}")
        return False

def test_2_admin_login():
    """Test 2: POST /api/auth/login returns 200 with is_admin=true and a token."""
    print_test("2. Admin login with correct credentials")
    
    try:
        payload = {
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        }
        response = requests.post(f"{BASE_URL}/auth/login", json=payload, timeout=10)
        print_info(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_info(f"Response: {json.dumps(data, indent=2)}")
            
            if data.get("is_admin") == True:
                print_pass("is_admin=true ✓")
            else:
                print_fail(f"is_admin={data.get('is_admin')}, expected True")
                return False
            
            if "token" in data and data["token"]:
                print_pass(f"Token received: {data['token'][:20]}...")
                return data["token"]
            else:
                print_fail("No token in response")
                return False
        else:
            print_fail(f"Expected 200, got {response.status_code}")
            print_info(f"Response: {response.text}")
            return False
    except Exception as e:
        print_fail(f"Exception: {e}")
        return False

def test_3_data_from_oi_pulse_db():
    """Test 3: Data is served from the consolidated oi_pulse DB."""
    print_test("3. Data served from consolidated oi_pulse DB")
    
    all_passed = True
    
    # Test GET /api/oi/NIFTY
    print_info("\n--- Testing GET /api/oi/NIFTY ---")
    try:
        response = requests.get(f"{BASE_URL}/oi/NIFTY", timeout=10)
        print_info(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_info(f"Response keys: {list(data.keys())}")
            
            if "price" in data and data["price"] is not None:
                print_pass(f"price={data['price']}")
            else:
                print_fail("price is missing or null")
                all_passed = False
            
            if "atm" in data and data["atm"] is not None:
                print_pass(f"atm={data['atm']}")
            else:
                print_fail("atm is missing or null")
                all_passed = False
            
            if "strikes" in data and isinstance(data["strikes"], list) and len(data["strikes"]) > 0:
                print_pass(f"strikes[] has {len(data['strikes'])} items")
            else:
                print_fail("strikes[] is missing or empty")
                all_passed = False
        else:
            print_fail(f"Expected 200, got {response.status_code}")
            all_passed = False
    except Exception as e:
        print_fail(f"Exception: {e}")
        all_passed = False
    
    # Test GET /api/oi/SENSEX
    print_info("\n--- Testing GET /api/oi/SENSEX ---")
    try:
        response = requests.get(f"{BASE_URL}/oi/SENSEX", timeout=10)
        print_info(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_info(f"Response keys: {list(data.keys())}")
            
            if "price" in data and data["price"] is not None:
                print_pass(f"price={data['price']}")
            else:
                print_fail("price is missing or null")
                all_passed = False
            
            if "atm" in data and data["atm"] is not None:
                print_pass(f"atm={data['atm']}")
            else:
                print_fail("atm is missing or null")
                all_passed = False
            
            if "strikes" in data and isinstance(data["strikes"], list) and len(data["strikes"]) > 0:
                print_pass(f"strikes[] has {len(data['strikes'])} items")
            else:
                print_fail("strikes[] is missing or empty")
                all_passed = False
        else:
            print_fail(f"Expected 200, got {response.status_code}")
            all_passed = False
    except Exception as e:
        print_fail(f"Exception: {e}")
        all_passed = False
    
    # Test GET /api/oi/BANKNIFTY
    print_info("\n--- Testing GET /api/oi/BANKNIFTY ---")
    try:
        response = requests.get(f"{BASE_URL}/oi/BANKNIFTY", timeout=10)
        print_info(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_info(f"Response keys: {list(data.keys())}")
            
            if "price" in data and data["price"] is not None:
                print_pass(f"price={data['price']}")
            else:
                print_fail("price is missing or null")
                all_passed = False
            
            if "atm" in data and data["atm"] is not None:
                print_pass(f"atm={data['atm']}")
            else:
                print_fail("atm is missing or null")
                all_passed = False
            
            if "strikes" in data and isinstance(data["strikes"], list) and len(data["strikes"]) > 0:
                print_pass(f"strikes[] has {len(data['strikes'])} items")
            else:
                print_fail("strikes[] is missing or empty")
                all_passed = False
        else:
            print_fail(f"Expected 200, got {response.status_code}")
            all_passed = False
    except Exception as e:
        print_fail(f"Exception: {e}")
        all_passed = False
    
    # Test GET /api/alerts
    print_info("\n--- Testing GET /api/alerts ---")
    try:
        response = requests.get(f"{BASE_URL}/alerts", timeout=10)
        print_info(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and "alerts" in data:
                alerts = data["alerts"]
                print_pass(f"Alerts returned: {len(alerts)} rows (expected ~17)")
                if len(alerts) >= 15:  # Allow some tolerance
                    print_pass("Alert count is within expected range")
                else:
                    print_fail(f"Expected ~17 alerts, got {len(alerts)}")
                    all_passed = False
            else:
                print_fail(f"Response format unexpected: {type(data)}, keys: {data.keys() if isinstance(data, dict) else 'N/A'}")
                all_passed = False
        else:
            print_fail(f"Expected 200, got {response.status_code}")
            all_passed = False
    except Exception as e:
        print_fail(f"Exception: {e}")
        all_passed = False
    
    # Test GET /api/history/NIFTY
    print_info("\n--- Testing GET /api/history/NIFTY ---")
    try:
        response = requests.get(f"{BASE_URL}/history/NIFTY", timeout=10)
        print_info(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and "history" in data and len(data["history"]) > 0:
                print_pass(f"History returned: {len(data['history'])} entries (non-empty)")
            elif isinstance(data, list) and len(data) > 0:
                print_pass(f"History returned: {len(data)} entries (non-empty)")
            elif isinstance(data, dict) and "series" in data and len(data["series"]) > 0:
                print_pass(f"History returned: {len(data['series'])} entries (non-empty)")
            else:
                print_fail(f"History is empty or invalid format. Type: {type(data)}, keys: {data.keys() if isinstance(data, dict) else 'N/A'}")
                all_passed = False
        else:
            print_fail(f"Expected 200, got {response.status_code}")
            all_passed = False
    except Exception as e:
        print_fail(f"Exception: {e}")
        all_passed = False
    
    return all_passed

def test_4_cors_verification():
    """Test 4: CORS verification with Origin header."""
    print_test("4. CORS verification with Origin: https://striklenz.com")
    
    all_passed = True
    origin = "https://striklenz.com"
    
    # Test OPTIONS preflight
    print_info("\n--- Testing OPTIONS preflight to /api/status ---")
    try:
        headers = {
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type"
        }
        response = requests.options(f"{BASE_URL}/status", headers=headers, timeout=10)
        print_info(f"Status Code: {response.status_code}")
        print_info(f"Response Headers: {dict(response.headers)}")
        
        if response.status_code in [200, 204]:
            print_pass(f"OPTIONS preflight returned {response.status_code}")
        else:
            print_fail(f"Expected 200 or 204, got {response.status_code}")
            all_passed = False
        
        # Check Access-Control-Allow-Origin header
        if "Access-Control-Allow-Origin" in response.headers:
            acao = response.headers["Access-Control-Allow-Origin"]
            print_pass(f"Access-Control-Allow-Origin: {acao}")
        else:
            print_fail("Access-Control-Allow-Origin header is missing")
            all_passed = False
        
        # Check that Access-Control-Allow-Credentials is NOT true
        if "Access-Control-Allow-Credentials" in response.headers:
            acac = response.headers["Access-Control-Allow-Credentials"]
            if acac.lower() == "true":
                print_fail(f"Access-Control-Allow-Credentials: {acac} (MUST be absent or false for header-token auth)")
                all_passed = False
            else:
                print_pass(f"Access-Control-Allow-Credentials: {acac} (not 'true', OK)")
        else:
            print_pass("Access-Control-Allow-Credentials header is absent (correct for header-token auth)")
    except Exception as e:
        print_fail(f"Exception: {e}")
        all_passed = False
    
    # Test GET with Origin header
    print_info("\n--- Testing GET /api/status with Origin header ---")
    try:
        headers = {"Origin": origin}
        response = requests.get(f"{BASE_URL}/status", headers=headers, timeout=10)
        print_info(f"Status Code: {response.status_code}")
        print_info(f"Response Headers: {dict(response.headers)}")
        
        if response.status_code == 200:
            print_pass("GET /api/status returned 200")
        else:
            print_fail(f"Expected 200, got {response.status_code}")
            all_passed = False
        
        # Check Access-Control-Allow-Origin header
        if "Access-Control-Allow-Origin" in response.headers:
            acao = response.headers["Access-Control-Allow-Origin"]
            print_pass(f"Access-Control-Allow-Origin: {acao}")
        else:
            print_fail("Access-Control-Allow-Origin header is missing")
            all_passed = False
        
        # Check that Access-Control-Allow-Credentials is NOT true
        if "Access-Control-Allow-Credentials" in response.headers:
            acac = response.headers["Access-Control-Allow-Credentials"]
            if acac.lower() == "true":
                print_fail(f"Access-Control-Allow-Credentials: {acac} (MUST be absent or false for header-token auth)")
                all_passed = False
            else:
                print_pass(f"Access-Control-Allow-Credentials: {acac} (not 'true', OK)")
        else:
            print_pass("Access-Control-Allow-Credentials header is absent (correct for header-token auth)")
    except Exception as e:
        print_fail(f"Exception: {e}")
        all_passed = False
    
    return all_passed

def test_5_admin_gated_endpoint():
    """Test 5: Admin-gated endpoint rejects unauthenticated requests."""
    print_test("5. Admin-gated endpoint rejects unauthenticated: POST /api/settings without token returns 401")
    
    try:
        payload = {"some": "data"}
        response = requests.post(f"{BASE_URL}/settings", json=payload, timeout=10)
        print_info(f"Status Code: {response.status_code}")
        print_info(f"Response: {response.text}")
        
        if response.status_code == 401:
            print_pass("POST /api/settings without token correctly returns 401")
            return True
        else:
            print_fail(f"Expected 401, got {response.status_code}")
            return False
    except Exception as e:
        print_fail(f"Exception: {e}")
        return False

def main():
    print("\n" + "="*80)
    print("StrikLenz Backend Verification Test")
    print("DB consolidation to oi_pulse + CORS hardening + Telegram token addition")
    print("="*80)
    
    results = {}
    
    # Test 1: Backend is up
    results["test_1"] = test_1_backend_up()
    
    # Test 2: Admin login
    token = test_2_admin_login()
    results["test_2"] = bool(token)
    
    # Test 3: Data from oi_pulse DB
    results["test_3"] = test_3_data_from_oi_pulse_db()
    
    # Test 4: CORS verification
    results["test_4"] = test_4_cors_verification()
    
    # Test 5: Admin-gated endpoint
    results["test_5"] = test_5_admin_gated_endpoint()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{test_name}: {status}")
    
    all_passed = all(results.values())
    
    print("\n" + "="*80)
    if all_passed:
        print("✅ ALL TESTS PASSED")
    else:
        print("❌ SOME TESTS FAILED")
    print("="*80)
    
    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
