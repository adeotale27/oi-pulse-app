#!/usr/bin/env python3
"""
Backend regression test for Round 4 (2026-07-17)
Task: Verify alerts do NOT fire when market is closed
"""

import requests
import time
from datetime import datetime, timezone, timedelta

# Backend URL from review request
BASE_URL = "https://strike-preview-1.preview.emergentagent.com/api"

def test_alerts_frozen_when_market_closed():
    """
    Test that alerts do NOT fire when market is closed.
    
    Procedure:
    1. GET /api/status → capture market.phase
    2. GET /api/alerts?limit=50 → capture count_before and latest created_at
    3. Sleep 90 seconds (exceeds 60s closed-market sleep interval)
    4. GET /api/alerts?limit=50 → capture count_after and latest created_at
    5. Assertions when phase != "open":
       - count_before == count_after
       - latest_before == latest_after
       - If any alert exists, verify created_at is OLDER than 90 seconds ago
    """
    print("\n" + "="*80)
    print("TEST: Alerts do NOT fire when market is closed")
    print("="*80)
    
    # Step 1: Get market phase
    print("\n[STEP 1] GET /api/status → capture market.phase")
    try:
        resp = requests.get(f"{BASE_URL}/status", timeout=10)
        resp.raise_for_status()
        status_data = resp.json()
        
        market_phase = status_data.get("market", {}).get("phase", "unknown")
        print(f"✓ Market phase: {market_phase}")
        
        if market_phase == "open":
            print("⚠️  WARNING: Market is OPEN. Test expects closed market (pre_open, post_close, weekend, holiday).")
            print("   Skipping alert-freeze assertion as per review request.")
            return {
                "test": "Alerts do NOT fire when market is closed",
                "status": "SKIPPED",
                "reason": f"Market phase is '{market_phase}' (open), test expects closed market",
                "market_phase": market_phase
            }
        
        print(f"✓ Market is closed (phase={market_phase}). Proceeding with alert-freeze test.")
        
    except Exception as e:
        print(f"✗ FAILED to get status: {e}")
        return {
            "test": "Alerts do NOT fire when market is closed",
            "status": "FAILED",
            "error": f"Failed to get status: {e}"
        }
    
    # Step 2: Get alerts BEFORE waiting
    print("\n[STEP 2] GET /api/alerts?limit=50 → capture count_before and latest created_at")
    try:
        resp = requests.get(f"{BASE_URL}/alerts", params={"limit": 50}, timeout=10)
        resp.raise_for_status()
        alerts_before = resp.json()
        
        count_before = len(alerts_before.get("alerts", []))
        latest_before = None
        
        if count_before > 0:
            latest_before = alerts_before["alerts"][0].get("created_at")
            print(f"✓ count_before: {count_before}")
            print(f"✓ latest_before: {latest_before}")
        else:
            print(f"✓ count_before: {count_before} (no alerts exist)")
            
    except Exception as e:
        print(f"✗ FAILED to get alerts (before): {e}")
        return {
            "test": "Alerts do NOT fire when market is closed",
            "status": "FAILED",
            "error": f"Failed to get alerts (before): {e}"
        }
    
    # Step 3: Sleep 90 seconds
    print("\n[STEP 3] Sleeping 90 seconds (exceeds 60s closed-market sleep interval)...")
    print("         This ensures at least one full 'would-have-polled' cycle passes.")
    
    for i in range(9):
        time.sleep(10)
        print(f"         ... {(i+1)*10}s elapsed")
    
    print("✓ 90 seconds elapsed")
    
    # Step 4: Get alerts AFTER waiting
    print("\n[STEP 4] GET /api/alerts?limit=50 → capture count_after and latest created_at")
    try:
        resp = requests.get(f"{BASE_URL}/alerts", params={"limit": 50}, timeout=10)
        resp.raise_for_status()
        alerts_after = resp.json()
        
        count_after = len(alerts_after.get("alerts", []))
        latest_after = None
        
        if count_after > 0:
            latest_after = alerts_after["alerts"][0].get("created_at")
            print(f"✓ count_after: {count_after}")
            print(f"✓ latest_after: {latest_after}")
        else:
            print(f"✓ count_after: {count_after} (no alerts exist)")
            
    except Exception as e:
        print(f"✗ FAILED to get alerts (after): {e}")
        return {
            "test": "Alerts do NOT fire when market is closed",
            "status": "FAILED",
            "error": f"Failed to get alerts (after): {e}"
        }
    
    # Step 5: Assertions
    print("\n[STEP 5] Assertions (when phase != 'open'):")
    
    failures = []
    
    # Assertion 1: count_before == count_after
    print(f"\n  Assertion 1: count_before ({count_before}) == count_after ({count_after})")
    if count_before == count_after:
        print(f"  ✓ PASS: Alert count unchanged ({count_before} → {count_after})")
    else:
        msg = f"Alert count CHANGED: {count_before} → {count_after} (expected no change when market closed)"
        print(f"  ✗ FAIL: {msg}")
        failures.append(msg)
    
    # Assertion 2: latest_before == latest_after
    print(f"\n  Assertion 2: latest_before == latest_after")
    if latest_before is None and latest_after is None:
        print(f"  ✓ PASS: No alerts exist (both None)")
    elif latest_before == latest_after:
        print(f"  ✓ PASS: Latest alert timestamp unchanged")
        print(f"    latest_before: {latest_before}")
        print(f"    latest_after:  {latest_after}")
    else:
        msg = f"Latest alert timestamp CHANGED: {latest_before} → {latest_after} (expected no change when market closed)"
        print(f"  ✗ FAIL: {msg}")
        failures.append(msg)
    
    # Assertion 3: If any alert exists, verify created_at is OLDER than 90 seconds ago
    print(f"\n  Assertion 3: If any alert exists, verify created_at is OLDER than 90 seconds ago")
    if latest_after is not None:
        try:
            # Parse ISO datetime
            alert_time = datetime.fromisoformat(latest_after.replace('Z', '+00:00'))
            now = datetime.now(timezone.utc)
            age_seconds = (now - alert_time).total_seconds()
            
            print(f"    Latest alert created_at: {latest_after}")
            print(f"    Current time: {now.isoformat()}")
            print(f"    Alert age: {age_seconds:.1f} seconds")
            
            if age_seconds > 90:
                print(f"  ✓ PASS: Alert is {age_seconds:.1f}s old (> 90s, created before test started)")
            else:
                msg = f"Alert is only {age_seconds:.1f}s old (< 90s), suggesting it was created DURING the test when market was closed"
                print(f"  ✗ FAIL: {msg}")
                failures.append(msg)
                
        except Exception as e:
            msg = f"Failed to parse alert timestamp: {e}"
            print(f"  ✗ FAIL: {msg}")
            failures.append(msg)
    else:
        print(f"  ✓ PASS: No alerts exist (nothing to check)")
    
    # Final verdict
    print("\n" + "="*80)
    if len(failures) == 0:
        print("✅ TEST PASSED: Alerts are correctly frozen when market is closed")
        print("="*80)
        return {
            "test": "Alerts do NOT fire when market is closed",
            "status": "PASSED",
            "market_phase": market_phase,
            "count_before": count_before,
            "count_after": count_after,
            "latest_before": latest_before,
            "latest_after": latest_after
        }
    else:
        print("❌ TEST FAILED: Alerts are NOT correctly frozen when market is closed")
        print("\nFailures:")
        for i, failure in enumerate(failures, 1):
            print(f"  {i}. {failure}")
        print("="*80)
        return {
            "test": "Alerts do NOT fire when market is closed",
            "status": "FAILED",
            "market_phase": market_phase,
            "count_before": count_before,
            "count_after": count_after,
            "latest_before": latest_before,
            "latest_after": latest_after,
            "failures": failures
        }


if __name__ == "__main__":
    print("\n" + "="*80)
    print("BACKEND REGRESSION TEST - ROUND 4 (2026-07-17)")
    print("Task: Verify alerts do NOT fire when market is closed")
    print("="*80)
    print(f"\nBackend URL: {BASE_URL}")
    print(f"Test date: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    
    result = test_alerts_frozen_when_market_closed()
    
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Status: {result['status']}")
    
    if result['status'] == 'PASSED':
        print(f"Market phase: {result['market_phase']}")
        print(f"Alert count before: {result['count_before']}")
        print(f"Alert count after: {result['count_after']}")
        print(f"Latest alert before: {result['latest_before']}")
        print(f"Latest alert after: {result['latest_after']}")
        print("\n✅ All assertions passed. Alerts are correctly frozen when market is closed.")
    elif result['status'] == 'SKIPPED':
        print(f"Reason: {result['reason']}")
        print(f"Market phase: {result['market_phase']}")
    elif result['status'] == 'FAILED':
        if 'error' in result:
            print(f"Error: {result['error']}")
        else:
            print(f"Market phase: {result.get('market_phase', 'unknown')}")
            print(f"Alert count before: {result.get('count_before', 'N/A')}")
            print(f"Alert count after: {result.get('count_after', 'N/A')}")
            print(f"Latest alert before: {result.get('latest_before', 'N/A')}")
            print(f"Latest alert after: {result.get('latest_after', 'N/A')}")
            print("\nFailures:")
            for i, failure in enumerate(result.get('failures', []), 1):
                print(f"  {i}. {failure}")
    
    print("="*80)
