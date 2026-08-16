#!/usr/bin/env python3
"""
Backend regression test — round 6
Task: Expiry dates must all be Tuesdays

For each idx in ["NIFTY", "BANKNIFTY", "SENSEX"]:
- GET /api/expiries/{idx} → 200
- Assert len(response.expiries) == 6
- Assert len(response.expiries_meta) == 6
- For every ISO date string in response.expiries, parse via datetime.date.fromisoformat(...)
  and assert d.weekday() == 1 (i.e. Tuesday). All six dates MUST be Tuesdays.
- Assert at least ONE item in expiries_meta has tag == "M" and at least ONE has tag == "W"

Constraints:
- No login required
- ≤5 total auth calls if any
- Do NOT mutate any state
"""

import requests
import datetime
import sys

# Backend URL from review request
BASE_URL = "https://strike-preview-1.preview.emergentagent.com/api"

def test_expiries_for_index(index_name):
    """Test expiries endpoint for a single index"""
    print(f"\n{'='*60}")
    print(f"Testing GET /api/expiries/{index_name}")
    print(f"{'='*60}")
    
    url = f"{BASE_URL}/expiries/{index_name}"
    
    try:
        response = requests.get(url, timeout=10)
        print(f"✓ HTTP Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"✗ FAIL: Expected 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"✓ Response is valid JSON")
        
        # Check required keys
        if 'expiries' not in data:
            print(f"✗ FAIL: Missing 'expiries' key in response")
            return False
        
        if 'expiries_meta' not in data:
            print(f"✗ FAIL: Missing 'expiries_meta' key in response")
            return False
        
        expiries = data['expiries']
        expiries_meta = data['expiries_meta']
        
        # Check length == 6
        print(f"✓ expiries count: {len(expiries)}")
        if len(expiries) != 6:
            print(f"✗ FAIL: Expected 6 expiries, got {len(expiries)}")
            return False
        print(f"✓ PASS: len(expiries) == 6")
        
        print(f"✓ expiries_meta count: {len(expiries_meta)}")
        if len(expiries_meta) != 6:
            print(f"✗ FAIL: Expected 6 expiries_meta, got {len(expiries_meta)}")
            return False
        print(f"✓ PASS: len(expiries_meta) == 6")
        
        # Check all dates are Tuesdays
        print(f"\nChecking all dates are Tuesdays (weekday == 1):")
        all_tuesdays = True
        for i, date_str in enumerate(expiries):
            try:
                date_obj = datetime.date.fromisoformat(date_str)
                weekday = date_obj.weekday()
                weekday_name = date_obj.strftime('%A')
                
                if weekday == 1:
                    print(f"  ✓ expiries[{i}]: {date_str} → {weekday_name} (weekday={weekday}) ✓")
                else:
                    print(f"  ✗ expiries[{i}]: {date_str} → {weekday_name} (weekday={weekday}) ✗ NOT TUESDAY")
                    all_tuesdays = False
            except Exception as e:
                print(f"  ✗ expiries[{i}]: {date_str} → Failed to parse: {e}")
                all_tuesdays = False
        
        if not all_tuesdays:
            print(f"✗ FAIL: Not all dates are Tuesdays")
            return False
        print(f"✓ PASS: All 6 dates are Tuesdays")
        
        # Check at least one M and one W tag
        print(f"\nChecking expiries_meta tags:")
        tags = [item.get('tag') for item in expiries_meta]
        print(f"  Tags found: {tags}")
        
        has_m = 'M' in tags
        has_w = 'W' in tags
        
        if has_m:
            print(f"  ✓ At least one tag='M' found")
        else:
            print(f"  ✗ No tag='M' found")
        
        if has_w:
            print(f"  ✓ At least one tag='W' found")
        else:
            print(f"  ✗ No tag='W' found")
        
        if not (has_m and has_w):
            print(f"✗ FAIL: Must have at least one 'M' and one 'W' tag")
            return False
        print(f"✓ PASS: At least one 'M' and one 'W' tag present")
        
        print(f"\n{'='*60}")
        print(f"✅ {index_name}: ALL TESTS PASSED")
        print(f"{'='*60}")
        return True
        
    except requests.exceptions.Timeout:
        print(f"✗ FAIL: Request timeout after 10 seconds")
        return False
    except requests.exceptions.RequestException as e:
        print(f"✗ FAIL: Request error: {e}")
        return False
    except Exception as e:
        print(f"✗ FAIL: Unexpected error: {e}")
        return False


def main():
    """Run tests for all three indices"""
    print("="*60)
    print("BACKEND REGRESSION TEST — ROUND 6")
    print("Task: Expiry dates must all be Tuesdays")
    print("="*60)
    print(f"Backend URL: {BASE_URL}")
    print(f"Test date: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    indices = ["NIFTY", "BANKNIFTY", "SENSEX"]
    results = {}
    
    for index_name in indices:
        results[index_name] = test_expiries_for_index(index_name)
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    for index_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {index_name}")
    
    all_passed = all(results.values())
    
    print("\n" + "="*60)
    if all_passed:
        print("✅ ALL TESTS PASSED")
        print("All expiry dates are Tuesdays for all three indices")
        print("All indices have at least one 'M' and one 'W' tag")
    else:
        print("❌ SOME TESTS FAILED")
        print("See details above")
    print("="*60)
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
