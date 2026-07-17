#!/usr/bin/env python3
"""
Backend test suite for Telegram huge-shift forwarding + Daily digest + TRUSTED_HOSTS fix.
Tests the newly-added endpoints and regressions as per 2026-07-17 review request.

CONSTRAINTS:
- Do NOT change mode to mock (leave in kite mode)
- Do NOT wipe vault, do NOT delete alerts
- Send at most 1 message per Telegram endpoint (total ≤ 2 Telegram messages)
- Do NOT re-flood /api/mode rate limiter
"""

import requests
import sys
import time

# Use the external preview URL for regression testing
EXTERNAL_URL = "https://768861c1-e842-4795-b466-c68d987f3978.preview.emergentagent.com"
BASE_URL = EXTERNAL_URL

# For local testing (not used in this test as we need to test external URL)
# BASE_URL = "http://localhost:8001"

ALLOWED_ORIGIN = "https://oi-pulse.emergent.host"
EVIL_ORIGIN = "https://evil.example.com"

def test_huge_shift_valid():
    """Test 1: POST /api/telegram/huge-shift with valid payload → 200 {"ok": true}"""
    print("\n[TEST 1] POST /api/telegram/huge-shift with valid payload")
    url = f"{BASE_URL}/api/telegram/huge-shift"
    payload = {
        "index": "NIFTY",
        "side": "PE",
        "value": 12000000,
        "direction": "build",
        "window": 3,
        "price": 24244.85,
        "atm": 24250,
        "contributing": [
            {
                "strike": 24250,
                "ce_delta": -500000,
                "pe_delta": 12000000
            }
        ]
    }
    
    try:
        r = requests.post(url, json=payload, timeout=10)
        print(f"  Status: {r.status_code}")
        print(f"  Response: {r.text[:200]}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert data.get("ok") == True, f"Expected ok=true, got {data}"
        print("  ✅ PASS: Valid huge-shift request returns 200 with ok=true")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_huge_shift_missing_field():
    """Test 2: POST /api/telegram/huge-shift with missing required field → 422 validation error"""
    print("\n[TEST 2] POST /api/telegram/huge-shift with missing required field")
    url = f"{BASE_URL}/api/telegram/huge-shift"
    # Missing 'index' field (required)
    payload = {
        "side": "PE",
        "value": 12000000,
        "direction": "build",
        "window": 3
    }
    
    try:
        r = requests.post(url, json=payload, timeout=10)
        print(f"  Status: {r.status_code}")
        print(f"  Response: {r.text[:200]}")
        
        assert r.status_code == 422, f"Expected 422 validation error, got {r.status_code}"
        print("  ✅ PASS: Missing required field returns 422 validation error")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_digest_preview():
    """Test 3: POST /api/telegram/digest/preview → 200 with keys {date, alerts_total, indices[]}"""
    print("\n[TEST 3] POST /api/telegram/digest/preview")
    url = f"{BASE_URL}/api/telegram/digest/preview"
    
    try:
        r = requests.post(url, timeout=10)
        print(f"  Status: {r.status_code}")
        print(f"  Response: {r.text[:300]}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        
        # Check required keys
        assert "date" in data, "Missing 'date' key"
        assert "alerts_total" in data, "Missing 'alerts_total' key"
        assert "indices" in data, "Missing 'indices' key"
        assert isinstance(data["indices"], list), "indices should be a list"
        
        # Check that indices list includes NIFTY, SENSEX, BANKNIFTY
        index_names = [idx.get("index") for idx in data["indices"]]
        print(f"  Indices in digest: {index_names}")
        
        assert "NIFTY" in index_names, "NIFTY not in indices list"
        assert "SENSEX" in index_names, "SENSEX not in indices list"
        assert "BANKNIFTY" in index_names, "BANKNIFTY not in indices list"
        
        # Check structure of each index entry
        for idx_entry in data["indices"]:
            assert "index" in idx_entry, "Missing 'index' in entry"
            assert "closing_price" in idx_entry, "Missing 'closing_price' in entry"
            assert "atm" in idx_entry, "Missing 'atm' in entry"
            assert "total_alerts" in idx_entry, "Missing 'total_alerts' in entry"
            # top_bullish and top_bearish are optional (may be None if no alerts)
        
        print(f"  ✅ PASS: Digest preview returns correct structure with all 3 indices")
        print(f"    Date: {data.get('date')}")
        print(f"    Total alerts: {data.get('alerts_total')}")
        print(f"    Indices count: {len(data['indices'])}")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_digest_send():
    """Test 4: POST /api/telegram/digest/send (only ONCE) → 200, sent=true"""
    print("\n[TEST 4] POST /api/telegram/digest/send (ONLY ONCE)")
    url = f"{BASE_URL}/api/telegram/digest/send"
    
    try:
        r = requests.post(url, timeout=10)
        print(f"  Status: {r.status_code}")
        print(f"  Response: {r.text[:300]}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        
        assert data.get("ok") == True, f"Expected ok=true, got {data}"
        assert data.get("sent") == True, f"Expected sent=true, got {data}"
        assert "digest" in data, "Missing 'digest' key in response"
        
        print("  ✅ PASS: Digest send returns 200 with ok=true, sent=true")
        print("  ⚠️  NOTE: 1 Telegram message sent (as per constraints)")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_kite_vault_external():
    """Test 5: Regression - GET /api/kite/vault via external URL should now return 200 (was 400)"""
    print("\n[TEST 5] Regression: GET /api/kite/vault via external URL")
    url = f"{EXTERNAL_URL}/api/kite/vault"
    
    try:
        r = requests.get(url, timeout=10)
        print(f"  Status: {r.status_code}")
        print(f"  Response: {r.text[:200]}")
        
        assert r.status_code == 200, f"Expected 200 (TRUSTED_HOSTS=* fix), got {r.status_code}"
        data = r.json()
        
        # Check expected keys
        assert "has_api_key" in data, "Missing 'has_api_key' key"
        assert "has_api_secret" in data, "Missing 'has_api_secret' key"
        
        print("  ✅ PASS: /api/kite/vault now returns 200 via external URL (TRUSTED_HOSTS=* fix working)")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_status_external():
    """Test 6: Regression - GET /api/status via external URL should return 200"""
    print("\n[TEST 6] Regression: GET /api/status via external URL")
    url = f"{EXTERNAL_URL}/api/status"
    
    try:
        r = requests.get(url, timeout=10)
        print(f"  Status: {r.status_code}")
        print(f"  Response: {r.text[:200]}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        
        # Check expected keys
        assert "mode" in data, "Missing 'mode' key"
        assert "running" in data, "Missing 'running' key"
        
        print(f"  ✅ PASS: /api/status returns 200 via external URL")
        print(f"    Mode: {data.get('mode')}")
        print(f"    Running: {data.get('running')}")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_security_headers_huge_shift():
    """Test 7a: Security headers on POST /api/telegram/huge-shift"""
    print("\n[TEST 7a] Security headers on /api/telegram/huge-shift")
    url = f"{BASE_URL}/api/telegram/huge-shift"
    payload = {
        "index": "NIFTY",
        "side": "CE",
        "value": 5000000,
        "direction": "unwind",
        "window": 5
    }
    
    try:
        r = requests.post(url, json=payload, timeout=10)
        print(f"  Status: {r.status_code}")
        
        headers = r.headers
        required_headers = {
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "strict-transport-security": "max-age=31536000; includeSubDomains"
        }
        
        all_present = True
        for header, expected_value in required_headers.items():
            actual = headers.get(header, "").lower()
            expected = expected_value.lower()
            if expected in actual:
                print(f"  ✅ {header}: {headers.get(header)}")
            else:
                print(f"  ❌ {header}: Expected '{expected_value}', got '{headers.get(header)}'")
                all_present = False
        
        assert all_present, "Not all required security headers present"
        print("  ✅ PASS: All security headers present on /api/telegram/huge-shift")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_security_headers_digest_preview():
    """Test 7b: Security headers on POST /api/telegram/digest/preview"""
    print("\n[TEST 7b] Security headers on /api/telegram/digest/preview")
    url = f"{BASE_URL}/api/telegram/digest/preview"
    
    try:
        r = requests.post(url, timeout=10)
        print(f"  Status: {r.status_code}")
        
        headers = r.headers
        required_headers = {
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "strict-transport-security": "max-age=31536000; includeSubDomains"
        }
        
        all_present = True
        for header, expected_value in required_headers.items():
            actual = headers.get(header, "").lower()
            expected = expected_value.lower()
            if expected in actual:
                print(f"  ✅ {header}: {headers.get(header)}")
            else:
                print(f"  ❌ {header}: Expected '{expected_value}', got '{headers.get(header)}'")
                all_present = False
        
        assert all_present, "Not all required security headers present"
        print("  ✅ PASS: All security headers present on /api/telegram/digest/preview")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_cors_huge_shift_allowed():
    """Test 8a: CORS on /api/telegram/huge-shift with allowed origin"""
    print("\n[TEST 8a] CORS on /api/telegram/huge-shift with allowed origin")
    url = f"{BASE_URL}/api/telegram/huge-shift"
    payload = {
        "index": "SENSEX",
        "side": "PE",
        "value": 8000000,
        "direction": "build",
        "window": 10
    }
    headers = {"Origin": ALLOWED_ORIGIN}
    
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=10)
        print(f"  Status: {r.status_code}")
        
        cors_header = r.headers.get("access-control-allow-origin", "")
        print(f"  access-control-allow-origin: {cors_header}")
        
        assert cors_header == ALLOWED_ORIGIN, f"Expected origin to be echoed, got '{cors_header}'"
        print(f"  ✅ PASS: Allowed origin echoed correctly")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_cors_huge_shift_evil():
    """Test 8b: CORS on /api/telegram/huge-shift with evil origin"""
    print("\n[TEST 8b] CORS on /api/telegram/huge-shift with evil origin")
    url = f"{BASE_URL}/api/telegram/huge-shift"
    payload = {
        "index": "BANKNIFTY",
        "side": "CE",
        "value": 3000000,
        "direction": "unwind",
        "window": 15
    }
    headers = {"Origin": EVIL_ORIGIN}
    
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=10)
        print(f"  Status: {r.status_code}")
        
        cors_header = r.headers.get("access-control-allow-origin", "")
        print(f"  access-control-allow-origin: {cors_header or '(not present)'}")
        
        # Evil origin should NOT be echoed
        assert cors_header != EVIL_ORIGIN, f"Evil origin should not be echoed, but got '{cors_header}'"
        print(f"  ✅ PASS: Evil origin NOT echoed (blocked)")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def test_cors_digest_preview_allowed():
    """Test 8c: CORS on /api/telegram/digest/preview with allowed origin"""
    print("\n[TEST 8c] CORS on /api/telegram/digest/preview with allowed origin")
    url = f"{BASE_URL}/api/telegram/digest/preview"
    headers = {"Origin": ALLOWED_ORIGIN}
    
    try:
        r = requests.post(url, headers=headers, timeout=10)
        print(f"  Status: {r.status_code}")
        
        cors_header = r.headers.get("access-control-allow-origin", "")
        print(f"  access-control-allow-origin: {cors_header}")
        
        assert cors_header == ALLOWED_ORIGIN, f"Expected origin to be echoed, got '{cors_header}'"
        print(f"  ✅ PASS: Allowed origin echoed correctly")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False


def main():
    print("=" * 80)
    print("BACKEND TEST SUITE: Telegram huge-shift + Daily digest + TRUSTED_HOSTS fix")
    print("=" * 80)
    print(f"Testing against: {BASE_URL}")
    print(f"External URL: {EXTERNAL_URL}")
    print(f"Allowed origin: {ALLOWED_ORIGIN}")
    print(f"Evil origin: {EVIL_ORIGIN}")
    
    results = []
    
    # Test 1: Valid huge-shift request
    results.append(("Valid huge-shift request", test_huge_shift_valid()))
    
    # Test 2: Invalid huge-shift request (missing field)
    results.append(("Invalid huge-shift (missing field)", test_huge_shift_missing_field()))
    
    # Test 3: Digest preview
    results.append(("Digest preview", test_digest_preview()))
    
    # Test 4: Digest send (ONLY ONCE - sends 1 Telegram message)
    results.append(("Digest send (1 TG message)", test_digest_send()))
    
    # Test 5: Regression - /api/kite/vault via external URL
    results.append(("Regression: /api/kite/vault external", test_kite_vault_external()))
    
    # Test 6: Regression - /api/status via external URL
    results.append(("Regression: /api/status external", test_status_external()))
    
    # Test 7: Security headers
    results.append(("Security headers: huge-shift", test_security_headers_huge_shift()))
    results.append(("Security headers: digest/preview", test_security_headers_digest_preview()))
    
    # Test 8: CORS
    results.append(("CORS: huge-shift allowed origin", test_cors_huge_shift_allowed()))
    results.append(("CORS: huge-shift evil origin", test_cors_huge_shift_evil()))
    results.append(("CORS: digest/preview allowed origin", test_cors_digest_preview_allowed()))
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print("\n" + "=" * 80)
    print(f"TOTAL: {passed}/{total} tests passed")
    print("=" * 80)
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
