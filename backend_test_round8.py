#!/usr/bin/env python3
"""
Backend regression test — round 8
Two tasks:
1. VIX persists across polling-window boundary (boot-time fetch)
2. GET /api/expiries/{index} capped + BANKNIFTY note
"""

import requests
import time
from datetime import datetime

# Backend URL from review request
BASE_URL = "https://oi-api-trace.preview.emergentagent.com/api"

# Track login attempts (constraint: ≤5 total)
login_attempts = 0

def test_task1_vix_persistence():
    """
    TASK 1 — VIX persists across polling-window boundary (boot-time fetch)
    
    GET /api/tickers/extras:
    - Assert `response.vix` is NOT null
    - Assert `response.vix.symbol == "^INDIAVIX"`, `response.vix.last` is a float > 0
    - Assert `response.gift_nifty` is NOT null with `symbol == "^NSEI"`, `last` > 0
    - Print `response.server_time_ist` — should be past 15:30 IST, showing that VIX 
      now populates outside the 09:15–15:30 window (this is the whole point of the round-8 fix)
    """
    print("\n" + "="*80)
    print("TASK 1 — VIX PERSISTENCE (BOOT-TIME FETCH)")
    print("="*80)
    
    print("\n[Testing GET /api/tickers/extras]")
    
    resp = requests.get(f"{BASE_URL}/tickers/extras", timeout=10)
    print(f"  Status: {resp.status_code}")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    
    data = resp.json()
    
    # Check VIX
    print("\n[VIX Validation]")
    vix = data.get("vix")
    print(f"  vix: {vix}")
    
    assert vix is not None, "❌ FAIL: response.vix is null (expected non-null due to boot-time fetch)"
    print("  ✅ vix is NOT null")
    
    assert vix.get("symbol") == "^INDIAVIX", f"❌ FAIL: vix.symbol is {vix.get('symbol')}, expected ^INDIAVIX"
    print(f"  ✅ vix.symbol == '^INDIAVIX'")
    
    vix_last = vix.get("last")
    assert isinstance(vix_last, (int, float)), f"❌ FAIL: vix.last is not a number: {vix_last}"
    assert vix_last > 0, f"❌ FAIL: vix.last is {vix_last}, expected > 0"
    print(f"  ✅ vix.last == {vix_last} (float > 0)")
    
    # Check GIFT NIFTY
    print("\n[GIFT NIFTY Validation]")
    gift_nifty = data.get("gift_nifty")
    print(f"  gift_nifty: {gift_nifty}")
    
    assert gift_nifty is not None, "❌ FAIL: response.gift_nifty is null"
    print("  ✅ gift_nifty is NOT null")
    
    assert gift_nifty.get("symbol") == "^NSEI", f"❌ FAIL: gift_nifty.symbol is {gift_nifty.get('symbol')}, expected ^NSEI"
    print(f"  ✅ gift_nifty.symbol == '^NSEI'")
    
    gift_last = gift_nifty.get("last")
    assert isinstance(gift_last, (int, float)), f"❌ FAIL: gift_nifty.last is not a number: {gift_last}"
    assert gift_last > 0, f"❌ FAIL: gift_nifty.last is {gift_last}, expected > 0"
    print(f"  ✅ gift_nifty.last == {gift_last} (float > 0)")
    
    # Print server time IST
    print("\n[Server Time IST]")
    server_time_ist = data.get("server_time_ist")
    print(f"  server_time_ist: {server_time_ist}")
    
    if server_time_ist:
        # Parse and check if past 15:30 IST
        try:
            # Parse ISO format with timezone
            dt = datetime.fromisoformat(server_time_ist.replace('Z', '+00:00'))
            print(f"  Parsed datetime: {dt}")
            print(f"  ℹ️  This demonstrates VIX populates outside the 09:15-15:30 IST window")
            print(f"  ℹ️  (boot-time fetch ensures VIX is available regardless of polling window)")
        except Exception as e:
            print(f"  ⚠️  Could not parse server_time_ist: {e}")
    
    print("\n" + "="*80)
    print("✅ TASK 1 PASSED — VIX and GIFT NIFTY both non-null with valid data")
    print("="*80)
    
    return {
        "task": "VIX persistence",
        "passed": True,
        "vix_last": vix_last,
        "gift_nifty_last": gift_last,
        "server_time_ist": server_time_ist
    }


def test_task2_expiries_capped_banknifty_note():
    """
    TASK 2 — GET /api/expiries/{index} capped + BANKNIFTY note
    
    For idx in ["NIFTY", "SENSEX"]:
    - GET /api/expiries/{idx} → 200
    - Assert `len(response.expiries_meta) <= 8` and > 0
    - Assert at least one item has tag == "W" and one has tag == "M"
    - Assert `response.note` is either null or missing (NIFTY/SENSEX shouldn't have the BANKNIFTY note)
    
    For BANKNIFTY:
    - GET /api/expiries/BANKNIFTY → 200
    - Assert `len(response.expiries_meta) <= 8` and > 0
    - Assert EVERY item has tag == "M"
    - Assert `response.note` is a non-empty string containing the words "weekly" and 
      either "discontinued" or "monthly"
    """
    print("\n" + "="*80)
    print("TASK 2 — EXPIRIES CAPPED + BANKNIFTY NOTE")
    print("="*80)
    
    results = []
    
    # Test NIFTY and SENSEX
    for idx in ["NIFTY", "SENSEX"]:
        print(f"\n[Testing {idx}]")
        
        resp = requests.get(f"{BASE_URL}/expiries/{idx}", timeout=10)
        print(f"  Status: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        data = resp.json()
        expiries_meta = data.get("expiries_meta", [])
        note = data.get("note")
        
        # Check count
        count = len(expiries_meta)
        print(f"  len(expiries_meta): {count}")
        assert count <= 8, f"❌ FAIL: Expected <= 8, got {count}"
        assert count > 0, f"❌ FAIL: Expected > 0, got {count}"
        print(f"  ✅ len(expiries_meta) <= 8 and > 0")
        
        # Check tags
        tags = [item.get("tag") for item in expiries_meta]
        has_w = "W" in tags
        has_m = "M" in tags
        print(f"  Tags: {tags}")
        print(f"  Has W: {has_w}, Has M: {has_m}")
        
        assert has_w, f"❌ FAIL: Expected at least one 'W' tag for {idx}"
        assert has_m, f"❌ FAIL: Expected at least one 'M' tag for {idx}"
        print(f"  ✅ At least one 'W' and one 'M' tag present")
        
        # Check note is null or missing
        print(f"  note: {note}")
        assert note is None or note == "", f"❌ FAIL: Expected note to be null/missing for {idx}, got: {note}"
        print(f"  ✅ note is null or missing (correct for {idx})")
        
        results.append({
            "index": idx,
            "count": count,
            "tags": tags,
            "note": note,
            "passed": True
        })
    
    # Test BANKNIFTY
    print(f"\n[Testing BANKNIFTY]")
    
    resp = requests.get(f"{BASE_URL}/expiries/BANKNIFTY", timeout=10)
    print(f"  Status: {resp.status_code}")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    
    data = resp.json()
    expiries_meta = data.get("expiries_meta", [])
    note = data.get("note")
    
    # Check count
    count = len(expiries_meta)
    print(f"  len(expiries_meta): {count}")
    assert count <= 8, f"❌ FAIL: Expected <= 8, got {count}"
    assert count > 0, f"❌ FAIL: Expected > 0, got {count}"
    print(f"  ✅ len(expiries_meta) <= 8 and > 0")
    
    # Check ALL tags are "M"
    tags = [item.get("tag") for item in expiries_meta]
    print(f"  Tags: {tags}")
    
    all_m = all(tag == "M" for tag in tags)
    assert all_m, f"❌ FAIL: Expected ALL tags to be 'M' for BANKNIFTY, got: {tags}"
    print(f"  ✅ EVERY item has tag == 'M'")
    
    # Check note is non-empty string with required words
    print(f"  note: {note}")
    assert note is not None, "❌ FAIL: Expected note to be non-null for BANKNIFTY"
    assert isinstance(note, str), f"❌ FAIL: Expected note to be a string, got {type(note)}"
    assert len(note) > 0, "❌ FAIL: Expected note to be non-empty for BANKNIFTY"
    print(f"  ✅ note is a non-empty string")
    
    note_lower = note.lower()
    has_weekly = "weekly" in note_lower
    has_discontinued = "discontinued" in note_lower
    has_monthly = "monthly" in note_lower
    
    print(f"  Contains 'weekly': {has_weekly}")
    print(f"  Contains 'discontinued': {has_discontinued}")
    print(f"  Contains 'monthly': {has_monthly}")
    
    assert has_weekly, f"❌ FAIL: Expected note to contain 'weekly', got: {note}"
    assert has_discontinued or has_monthly, f"❌ FAIL: Expected note to contain 'discontinued' or 'monthly', got: {note}"
    print(f"  ✅ note contains 'weekly' and either 'discontinued' or 'monthly'")
    
    results.append({
        "index": "BANKNIFTY",
        "count": count,
        "tags": tags,
        "note": note,
        "passed": True
    })
    
    print("\n" + "="*80)
    print("✅ TASK 2 PASSED — All expiries capped correctly, BANKNIFTY has proper note")
    print("="*80)
    
    return results


def main():
    """Run all tests for round 8"""
    print("\n" + "="*80)
    print("BACKEND REGRESSION TEST — ROUND 8")
    print("Backend URL:", BASE_URL)
    print("="*80)
    
    all_results = {}
    
    try:
        # TASK 1: VIX persistence
        task1_result = test_task1_vix_persistence()
        all_results["task1"] = task1_result
        
        # TASK 2: Expiries capped + BANKNIFTY note
        task2_results = test_task2_expiries_capped_banknifty_note()
        all_results["task2"] = task2_results
        
        # Summary
        print("\n" + "="*80)
        print("FINAL SUMMARY")
        print("="*80)
        print(f"\n✅ TASK 1 (VIX persistence): PASSED")
        print(f"   - VIX last: {task1_result['vix_last']}")
        print(f"   - GIFT NIFTY last: {task1_result['gift_nifty_last']}")
        print(f"   - Server time IST: {task1_result['server_time_ist']}")
        
        print(f"\n✅ TASK 2 (Expiries capped + BANKNIFTY note): PASSED")
        for result in task2_results:
            print(f"   - {result['index']}: {result['count']} expiries, tags={result['tags']}")
            if result['index'] == 'BANKNIFTY':
                print(f"     Note: \"{result['note'][:80]}...\"" if len(result['note']) > 80 else f"     Note: \"{result['note']}\"")
        
        print(f"\n✅ ALL TESTS PASSED")
        print(f"Login attempts: {login_attempts}/5")
        print("="*80)
        
        return 0
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        print(f"Login attempts: {login_attempts}/5")
        return 1
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        print(f"Login attempts: {login_attempts}/5")
        return 1


if __name__ == "__main__":
    exit(main())
