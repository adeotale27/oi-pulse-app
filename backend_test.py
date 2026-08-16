#!/usr/bin/env python3
"""
Backend verification for StrikLenz Kite credentials bug fix.
Bug: POST /api/credentials returned "ModuleNotFoundError: No module named 'twisted'"
Fix: Installed twisted/autobahn/pyOpenSSL/service_identity (kiteconnect's KiteTicker deps)
"""
import requests
import json
import sys

# Read the external base URL from frontend/.env
with open('/app/frontend/.env', 'r') as f:
    for line in f:
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = line.strip().split('=', 1)[1]
            break
    else:
        print("❌ REACT_APP_BACKEND_URL not found in frontend/.env")
        sys.exit(1)

API_URL = f"{BASE_URL}/api"
print(f"Testing against: {API_URL}\n")

# Admin credentials from test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = "Q@w3e4r5"

def test_1_admin_login():
    """Test 1: POST /api/auth/login with admin credentials"""
    print("=" * 80)
    print("TEST 1: POST /api/auth/login")
    print("=" * 80)
    
    url = f"{API_URL}/auth/login"
    payload = {
        "username": ADMIN_USERNAME,
        "password": ADMIN_PASSWORD
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {json.dumps(response.json(), indent=2)}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get("is_admin") is True and "token" in data:
                print("✅ PASS: Login successful, is_admin=true, token received")
                return data["token"]
            else:
                print(f"❌ FAIL: Expected is_admin=true and token, got: {data}")
                return None
        else:
            print(f"❌ FAIL: Expected 200, got {response.status_code}")
            return None
    except Exception as e:
        print(f"❌ FAIL: Exception during login: {e}")
        return None

def test_2_save_kite_credentials(admin_token):
    """Test 2: POST /api/credentials - THE KEY CHECK for twisted import fix"""
    print("\n" + "=" * 80)
    print("TEST 2: POST /api/credentials (KEY CHECK: twisted import)")
    print("=" * 80)
    
    if not admin_token:
        print("⚠️  SKIP: No admin token from test 1")
        return False
    
    url = f"{API_URL}/credentials"
    headers = {
        "X-Admin-Token": admin_token,
        "Content-Type": "application/json"
    }
    payload = {
        "api_key": "testkey123",
        "access_token": "testtoken123"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        print(f"Status Code: {response.status_code}")
        
        try:
            body = response.json()
            print(f"Response Body: {json.dumps(body, indent=2)}")
        except (json.JSONDecodeError, ValueError):
            body_text = response.text
            print(f"Response Body (text): {body_text}")
            body = {"raw": body_text}
        
        # Convert response to string for checking
        response_str = json.dumps(body) if isinstance(body, dict) else str(body)
        
        # Check for the bug: ModuleNotFoundError or twisted
        if "ModuleNotFoundError" in response_str or "No module named 'twisted'" in response_str:
            print("❌ FAIL: Response contains 'ModuleNotFoundError' or 'twisted' - bug NOT fixed")
            return False
        
        # A 400 with Kite auth error is EXPECTED and PASSING (proves import works)
        if response.status_code == 400:
            # Check if it's a Kite-style auth error
            error_msg = body.get("detail", "") or body.get("error", "") or str(body)
            if any(keyword in error_msg.lower() for keyword in ["invalid", "token", "api_key", "access_token", "kite", "auth"]):
                print("✅ PASS: Got expected 400 with Kite auth error (proves twisted import is fixed)")
                print(f"   Error message: {error_msg}")
                return True
            else:
                print(f"⚠️  WARNING: Got 400 but unclear if it's a Kite auth error: {error_msg}")
                return True  # Still passing since no twisted error
        
        # 500 would indicate a server error (potential bug)
        if response.status_code == 500:
            print("❌ FAIL: Got 500 server error - potential issue")
            return False
        
        # 200 would mean credentials were accepted (unlikely with dummy creds)
        if response.status_code == 200:
            print("✅ PASS: Got 200 (credentials accepted - unexpected but no twisted error)")
            return True
        
        # Any other status code
        print(f"⚠️  Got status {response.status_code} - no twisted error detected")
        return True
        
    except Exception as e:
        print(f"❌ FAIL: Exception during credentials save: {e}")
        return False

def test_3_status_endpoint():
    """Test 3: GET /api/status"""
    print("\n" + "=" * 80)
    print("TEST 3: GET /api/status")
    print("=" * 80)
    
    url = f"{API_URL}/status"
    
    try:
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Response Body: {json.dumps(data, indent=2)}")
            print("✅ PASS: Status endpoint returned 200")
            return True
        else:
            print(f"Response Body: {response.text}")
            print(f"❌ FAIL: Expected 200, got {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception during status check: {e}")
        return False

def test_4_oi_nifty_endpoint():
    """Test 4: GET /api/oi/NIFTY - verify restored data"""
    print("\n" + "=" * 80)
    print("TEST 4: GET /api/oi/NIFTY")
    print("=" * 80)
    
    url = f"{API_URL}/oi/NIFTY"
    
    try:
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            # Check for required fields
            required_fields = ["price", "atm", "strikes"]
            missing_fields = [f for f in required_fields if f not in data]
            
            if missing_fields:
                print(f"Response Body: {json.dumps(data, indent=2)}")
                print(f"❌ FAIL: Missing required fields: {missing_fields}")
                return False
            
            # Print summary
            print(f"Price: {data.get('price')}")
            print(f"ATM: {data.get('atm')}")
            print(f"Strikes count: {len(data.get('strikes', []))}")
            print(f"PCR: {data.get('pcr', 'N/A')}")
            
            if data.get('price') and data.get('atm') and len(data.get('strikes', [])) > 0:
                print("✅ PASS: OI NIFTY endpoint returned valid snapshot with restored data")
                return True
            else:
                print(f"❌ FAIL: Data incomplete - price={data.get('price')}, atm={data.get('atm')}, strikes={len(data.get('strikes', []))}")
                return False
        else:
            print(f"Response Body: {response.text}")
            print(f"❌ FAIL: Expected 200, got {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception during OI NIFTY check: {e}")
        return False

def main():
    print("StrikLenz Backend Verification - Kite Credentials Bug Fix")
    print("Bug: ModuleNotFoundError: No module named 'twisted'")
    print("Fix: Installed twisted/autobahn/pyOpenSSL/service_identity\n")
    
    results = {}
    
    # Test 1: Admin login
    admin_token = test_1_admin_login()
    results["test_1_login"] = admin_token is not None
    
    # Test 2: Save Kite credentials (KEY CHECK)
    results["test_2_credentials"] = test_2_save_kite_credentials(admin_token)
    
    # Test 3: Status endpoint
    results["test_3_status"] = test_3_status_endpoint()
    
    # Test 4: OI NIFTY endpoint
    results["test_4_oi_nifty"] = test_4_oi_nifty_endpoint()
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    all_passed = all(results.values())
    
    print("\n" + "=" * 80)
    if all_passed:
        print("✅ ALL TESTS PASSED - Bug fix verified successfully")
    else:
        print("❌ SOME TESTS FAILED - See details above")
    print("=" * 80)
    
    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
