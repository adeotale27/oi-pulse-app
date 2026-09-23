#!/usr/bin/env python3
"""
Backend API test suite for Striklenz platform layer + auth regression.
Tests the new platform endpoints and verifies existing auth still works.
"""
import requests
import json
import sys
from typing import Dict, Any, Optional

# Backend URL - using internal address since we're in the same container
BASE_URL = "http://127.0.0.1:8001/api"

# Admin credentials from test_credentials.md
ADMIN_USERNAME = "Adeotale"
ADMIN_PASSWORD = "Striklenz@2025"

# Test results tracking
tests_passed = 0
tests_failed = 0
failures = []


def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    global tests_passed, tests_failed, failures
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  {details}")
    if passed:
        tests_passed += 1
    else:
        tests_failed += 1
        failures.append(f"{name}: {details}")


def test_admin_login() -> Optional[str]:
    """Test 1.1: POST /api/auth/login - Admin login"""
    print("\n=== TEST 1: EXISTING AUTH (Regression) ===\n")
    print("Test 1.1: Admin Login")
    
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
            timeout=10
        )
        
        if response.status_code != 200:
            log_test("Admin Login", False, f"Expected 200, got {response.status_code}: {response.text}")
            return None
        
        data = response.json()
        
        # Check for required fields
        if not data.get("token"):
            log_test("Admin Login", False, "No token in response")
            return None
        
        if not data.get("is_admin"):
            log_test("Admin Login", False, f"is_admin is {data.get('is_admin')}, expected True")
            return None
        
        log_test("Admin Login", True, f"Token received: {data['token'][:20]}...")
        return data["token"]
        
    except Exception as e:
        log_test("Admin Login", False, f"Exception: {e}")
        return None


def test_auth_state():
    """Test 1.2: GET /api/auth/state"""
    print("\nTest 1.2: Auth State")
    
    try:
        response = requests.get(f"{BASE_URL}/auth/state", timeout=10)
        
        if response.status_code != 200:
            log_test("Auth State", False, f"Expected 200, got {response.status_code}: {response.text}")
            return
        
        data = response.json()
        
        # Should have requires_login or public_access_open fields
        if "requires_login" not in data and "public_access_open" not in data:
            log_test("Auth State", False, f"Missing expected fields in response: {data}")
            return
        
        log_test("Auth State", True, f"Response: {json.dumps(data, indent=2)}")
        
    except Exception as e:
        log_test("Auth State", False, f"Exception: {e}")


def test_guest_auth():
    """Test 1.3: POST /api/auth/guest"""
    print("\nTest 1.3: Guest Auth")
    
    try:
        response = requests.post(
            f"{BASE_URL}/auth/guest",
            json={"name": "Test User"},
            timeout=10
        )
        
        # 200 with token/pending OR 403 when public access closed are both valid
        if response.status_code == 403:
            # Public access is closed - this is acceptable
            log_test("Guest Auth", True, f"403 - Public access closed (acceptable)")
            return
        
        if response.status_code != 200:
            log_test("Guest Auth", False, f"Expected 200 or 403, got {response.status_code}: {response.text}")
            return
        
        data = response.json()
        
        # Should have either token OR status=pending with request_id
        has_token = "token" in data
        has_pending = data.get("status") == "pending" and "request_id" in data
        
        if not (has_token or has_pending):
            log_test("Guest Auth", False, f"Expected token OR status=pending with request_id, got: {data}")
            return
        
        if has_token:
            log_test("Guest Auth", True, f"Token received: {data['token'][:20]}...")
        else:
            log_test("Guest Auth", True, f"Pending approval, request_id: {data['request_id']}")
        
    except Exception as e:
        log_test("Guest Auth", False, f"Exception: {e}")


def test_public_site_config():
    """Test 2: GET /api/public/site-config - Public config (no auth)"""
    print("\n=== TEST 2: NEW PUBLIC CONFIG (No Auth) ===\n")
    print("Test 2: Public Site Config")
    
    try:
        response = requests.get(f"{BASE_URL}/public/site-config", timeout=10)
        
        if response.status_code != 200:
            log_test("Public Site Config", False, f"Expected 200, got {response.status_code}: {response.text}")
            return None
        
        data = response.json()
        
        # Check required keys
        required_keys = ["app_name", "pricing", "features", "brokers"]
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            log_test("Public Site Config", False, f"Missing keys: {missing_keys}")
            return None
        
        # Check pricing structure
        pricing = data.get("pricing", {})
        if "free" not in pricing or "premium" not in pricing:
            log_test("Public Site Config", False, f"Pricing missing free/premium: {pricing}")
            return None
        
        # Check features
        features = data.get("features", {})
        if "google_login_enabled" not in features or "razorpay_enabled" not in features:
            log_test("Public Site Config", False, f"Features missing expected keys: {features}")
            return None
        
        # Initially google_login_enabled should be false
        google_enabled = features.get("google_login_enabled")
        
        # Check brokers
        brokers = data.get("brokers", [])
        if not isinstance(brokers, list):
            log_test("Public Site Config", False, f"Brokers should be array, got: {type(brokers)}")
            return None
        
        # Find zerodha broker
        zerodha = next((b for b in brokers if b.get("id") == "zerodha"), None)
        if not zerodha:
            log_test("Public Site Config", False, "Zerodha broker not found in brokers array")
            return None
        
        if not zerodha.get("enabled"):
            log_test("Public Site Config", False, f"Zerodha enabled should be true, got: {zerodha.get('enabled')}")
            return None
        
        log_test("Public Site Config", True, 
                f"app_name={data['app_name']}, google_login_enabled={google_enabled}, "
                f"razorpay_enabled={features.get('razorpay_enabled')}, zerodha.enabled=true")
        
        return data
        
    except Exception as e:
        log_test("Public Site Config", False, f"Exception: {e}")
        return None


def test_admin_platform_config_no_auth():
    """Test 3.1: GET /api/admin/platform/config without auth - should return 401"""
    print("\n=== TEST 3: NEW ADMIN PLATFORM CONFIG (Admin-gated) ===\n")
    print("Test 3.1: Admin Platform Config - No Auth (expect 401)")
    
    try:
        response = requests.get(f"{BASE_URL}/admin/platform/config", timeout=10)
        
        if response.status_code != 401:
            log_test("Admin Platform Config - No Auth", False, 
                    f"Expected 401, got {response.status_code}: {response.text}")
            return
        
        log_test("Admin Platform Config - No Auth", True, "Correctly rejected with 401")
        
    except Exception as e:
        log_test("Admin Platform Config - No Auth", False, f"Exception: {e}")


def test_admin_platform_config_with_auth(admin_token: str):
    """Test 3.2: GET /api/admin/platform/config with auth"""
    print("\nTest 3.2: Admin Platform Config - With Auth")
    
    try:
        headers = {"X-Admin-Token": admin_token}
        response = requests.get(f"{BASE_URL}/admin/platform/config", headers=headers, timeout=10)
        
        if response.status_code != 200:
            log_test("Admin Platform Config - With Auth", False, 
                    f"Expected 200, got {response.status_code}: {response.text}")
            return None
        
        data = response.json()
        
        # Check required keys
        required_keys = ["pricing", "brokers", "google", "razorpay"]
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            log_test("Admin Platform Config - With Auth", False, f"Missing keys: {missing_keys}")
            return None
        
        # CRITICAL SECURITY CHECK: Verify secrets are masked
        google = data.get("google", {})
        razorpay = data.get("razorpay", {})
        
        # client_secret must be null or "set", never a real value
        client_secret = google.get("client_secret")
        if client_secret and client_secret not in [None, "set"]:
            log_test("Admin Platform Config - With Auth", False, 
                    f"SECURITY ISSUE: client_secret exposed in plaintext: {client_secret}")
            return None
        
        # razorpay key_secret must be null or "set", never a real value
        key_secret = razorpay.get("key_secret")
        if key_secret and key_secret not in [None, "set"]:
            log_test("Admin Platform Config - With Auth", False, 
                    f"SECURITY ISSUE: razorpay.key_secret exposed in plaintext: {key_secret}")
            return None
        
        log_test("Admin Platform Config - With Auth", True, 
                f"Secrets properly masked: client_secret={client_secret}, key_secret={key_secret}")
        
        return data
        
    except Exception as e:
        log_test("Admin Platform Config - With Auth", False, f"Exception: {e}")
        return None


def test_admin_platform_config_update(admin_token: str):
    """Test 3.3: POST /api/admin/platform/config - Update config"""
    print("\nTest 3.3: Admin Platform Config - Update")
    
    try:
        headers = {"X-Admin-Token": admin_token}
        payload = {
            "pricing": {
                "premium": {
                    "monthly": 1299
                }
            },
            "google": {
                "enabled": True,
                "client_id": "test-cid",
                "client_secret": "test-secret"
            }
        }
        
        response = requests.post(
            f"{BASE_URL}/admin/platform/config",
            headers=headers,
            json=payload,
            timeout=10
        )
        
        if response.status_code != 200:
            log_test("Admin Platform Config - Update", False, 
                    f"Expected 200, got {response.status_code}: {response.text}")
            return False
        
        data = response.json()
        if not data.get("ok"):
            log_test("Admin Platform Config - Update", False, f"Expected ok:true, got: {data}")
            return False
        
        log_test("Admin Platform Config - Update", True, "Config updated successfully")
        return True
        
    except Exception as e:
        log_test("Admin Platform Config - Update", False, f"Exception: {e}")
        return False


def test_admin_platform_config_verify_update(admin_token: str):
    """Test 3.4: Verify the update was applied and secrets are masked"""
    print("\nTest 3.4: Admin Platform Config - Verify Update")
    
    try:
        headers = {"X-Admin-Token": admin_token}
        response = requests.get(f"{BASE_URL}/admin/platform/config", headers=headers, timeout=10)
        
        if response.status_code != 200:
            log_test("Admin Platform Config - Verify Update", False, 
                    f"Expected 200, got {response.status_code}: {response.text}")
            return False
        
        data = response.json()
        
        # Check premium.monthly = 1299
        premium_monthly = data.get("pricing", {}).get("premium", {}).get("monthly")
        if premium_monthly != 1299:
            log_test("Admin Platform Config - Verify Update", False, 
                    f"Expected premium.monthly=1299, got {premium_monthly}")
            return False
        
        # Check google.enabled = true
        google = data.get("google", {})
        if not google.get("enabled"):
            log_test("Admin Platform Config - Verify Update", False, 
                    f"Expected google.enabled=true, got {google.get('enabled')}")
            return False
        
        # Check google.client_id = "test-cid"
        if google.get("client_id") != "test-cid":
            log_test("Admin Platform Config - Verify Update", False, 
                    f"Expected google.client_id='test-cid', got {google.get('client_id')}")
            return False
        
        # CRITICAL: Check google.client_secret is masked (should be "set", not "test-secret")
        client_secret = google.get("client_secret")
        if client_secret != "set":
            log_test("Admin Platform Config - Verify Update", False, 
                    f"SECURITY ISSUE: client_secret should be 'set' (masked), got: {client_secret}")
            return False
        
        log_test("Admin Platform Config - Verify Update", True, 
                f"premium.monthly=1299, google.enabled=true, client_id='test-cid', client_secret='set' (masked)")
        return True
        
    except Exception as e:
        log_test("Admin Platform Config - Verify Update", False, f"Exception: {e}")
        return False


def test_public_site_config_reflects_changes():
    """Test 3.5: Verify public config reflects the admin changes"""
    print("\nTest 3.5: Public Site Config - Verify Google Login Enabled")
    
    try:
        response = requests.get(f"{BASE_URL}/public/site-config", timeout=10)
        
        if response.status_code != 200:
            log_test("Public Site Config - Verify Changes", False, 
                    f"Expected 200, got {response.status_code}: {response.text}")
            return
        
        data = response.json()
        
        # Check features.google_login_enabled is now true
        google_enabled = data.get("features", {}).get("google_login_enabled")
        if not google_enabled:
            log_test("Public Site Config - Verify Changes", False, 
                    f"Expected google_login_enabled=true, got {google_enabled}")
            return
        
        log_test("Public Site Config - Verify Changes", True, 
                f"features.google_login_enabled=true (reflects admin config)")
        
    except Exception as e:
        log_test("Public Site Config - Verify Changes", False, f"Exception: {e}")


def test_google_login_url():
    """Test 4: GET /api/auth/google/login-url"""
    print("\n=== TEST 4: NEW GOOGLE LOGIN URL ===\n")
    print("Test 4: Google Login URL")
    
    try:
        response = requests.get(
            f"{BASE_URL}/auth/google/login-url",
            params={"redirect_uri": "https://striklenz.com/login"},
            timeout=10
        )
        
        if response.status_code != 200:
            log_test("Google Login URL", False, 
                    f"Expected 200, got {response.status_code}: {response.text}")
            return
        
        data = response.json()
        
        # Should have configured=true after we set the config
        if not data.get("configured"):
            log_test("Google Login URL", False, 
                    f"Expected configured=true, got {data.get('configured')}")
            return
        
        # Should have url
        url = data.get("url", "")
        if not url.startswith("https://accounts.google.com/o/oauth2/v2/auth"):
            log_test("Google Login URL", False, 
                    f"URL should start with Google OAuth endpoint, got: {url}")
            return
        
        # URL should include client_id=test-cid
        if "client_id=test-cid" not in url:
            log_test("Google Login URL", False, 
                    f"URL should include client_id=test-cid, got: {url}")
            return
        
        log_test("Google Login URL", True, 
                f"configured=true, url starts with Google OAuth endpoint, includes client_id=test-cid")
        
    except Exception as e:
        log_test("Google Login URL", False, f"Exception: {e}")


def test_status_regression():
    """Test 5.1: GET /api/status - Regression test"""
    print("\n=== TEST 5: REGRESSION TESTS ===\n")
    print("Test 5.1: Status Endpoint")
    
    try:
        response = requests.get(f"{BASE_URL}/status", timeout=10)
        
        if response.status_code != 200:
            log_test("Status Endpoint", False, 
                    f"Expected 200, got {response.status_code}: {response.text}")
            return
        
        data = response.json()
        
        # Should have running field
        if "running" not in data:
            log_test("Status Endpoint", False, f"Missing 'running' field in response: {data}")
            return
        
        log_test("Status Endpoint", True, f"running={data.get('running')}")
        
    except Exception as e:
        log_test("Status Endpoint", False, f"Exception: {e}")


def test_oi_nifty_regression():
    """Test 5.2: GET /api/oi/NIFTY - Regression test"""
    print("\nTest 5.2: OI NIFTY Endpoint")
    
    try:
        response = requests.get(f"{BASE_URL}/oi/NIFTY", timeout=10)
        
        # 200 or 503 (no data yet) are both acceptable
        if response.status_code == 200:
            data = response.json()
            log_test("OI NIFTY Endpoint", True, 
                    f"200 OK - Data available (offline/demo mode acceptable)")
        elif response.status_code == 503:
            log_test("OI NIFTY Endpoint", True, 
                    f"503 No data yet (acceptable for offline mode)")
        else:
            log_test("OI NIFTY Endpoint", False, 
                    f"Expected 200 or 503, got {response.status_code}: {response.text}")
        
    except Exception as e:
        log_test("OI NIFTY Endpoint", False, f"Exception: {e}")


def main():
    """Run all tests"""
    print("=" * 80)
    print("STRIKLENZ BACKEND TESTING - Platform Layer + Auth Regression")
    print("=" * 80)
    
    # Test 1: Existing Auth (Regression)
    admin_token = test_admin_login()
    if not admin_token:
        print("\n❌ CRITICAL: Admin login failed. Cannot proceed with admin-gated tests.")
        print_summary()
        sys.exit(1)
    
    test_auth_state()
    test_guest_auth()
    
    # Test 2: Public Config (No Auth)
    test_public_site_config()
    
    # Test 3: Admin Platform Config (Admin-gated)
    test_admin_platform_config_no_auth()
    test_admin_platform_config_with_auth(admin_token)
    
    # Update config and verify
    if test_admin_platform_config_update(admin_token):
        test_admin_platform_config_verify_update(admin_token)
        test_public_site_config_reflects_changes()
    
    # Test 4: Google Login URL
    test_google_login_url()
    
    # Test 5: Regression Tests
    test_status_regression()
    test_oi_nifty_regression()
    
    # Print summary
    print_summary()
    
    # Exit with appropriate code
    sys.exit(0 if tests_failed == 0 else 1)


def print_summary():
    """Print test summary"""
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total Tests: {tests_passed + tests_failed}")
    print(f"✅ Passed: {tests_passed}")
    print(f"❌ Failed: {tests_failed}")
    
    if failures:
        print("\n❌ FAILURES:")
        for i, failure in enumerate(failures, 1):
            print(f"{i}. {failure}")
    
    print("=" * 80)


if __name__ == "__main__":
    main()
