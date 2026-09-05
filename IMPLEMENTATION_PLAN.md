# Implementation Plan: BSE SENSEX Support for CAS Auto Trade

## Goals
1. Add BSE SENSEX indicative close support alongside NSE NIFTY
2. Track and display time when first indicative entry is caught for each index
3. Support configurable default days (NSE: Mon/Tue, BSE: Wed/Thu)
4. Show duplicate tiles when both indices are enabled
5. Maintain backward compatibility

## Files to Modify

### Backend
1. `backend/cas_auto_trade.py` - Core logic for dual index processing
2. `backend/cas_bridge.py` - Already updated with BSE settings
3. `backend/cas_indicative_bse.py` - BSE indicative provider (needs validation)
4. `backend/server.py` - API endpoint updates if needed

### Frontend
1. `frontend/src/components/CasPanel.jsx` - UI for toggle, timing display, dual tiles

## Detailed Changes

### 1. Backend - cas_auto_trade.py
- Modify to support multiple indices (NIFTY, SENSEX)
- Add BSEIndicativeProvider alongside NseIndicativeProvider
- Track first pickup time for each index to calculate latency
- Support dual processing when both indices enabled
- Maintain separate state machines for each index
- Update decision logic to work per-index
- Update snapshot to include BSE data

### 2. Backend - cas_bridge.py
- Already updated with:
  - `bse_enabled`: Boolean toggle for BSE support
  - `bse_poll_ms`: BSE polling interval (default 500ms)
  - `bse_default_days`: ["wed", "thu"] 
  - `nse_default_days`: ["mon", "tue"]

### 3. Backend - cas_indicative_bse.py
- Validate BSE API endpoints
- Test HTML fallback scraping
- Implement proper error handling
- Add timing tracking for first fetch

### 4. Frontend - CasPanel.jsx
- Add BSE enable/disable toggle in settings section
- Display timing information: "First indicative caught at HH:MM:SS.mmm"
- Show latency: "Latency: XXXms"
- When both indices enabled: show duplicate tiles/sections for each
- Implement default day logic: NSE Mon/Tue, BSE Wed/Thu
- Allow override via admin settings
- Update AutoTapeStrip to handle both indices
- Update status displays to show both indices when applicable

## Implementation Approach

### Phase 1: Backend Foundation
1. Validate and test BSE indicative provider
2. Modify cas_auto_trade.py to support multiple providers
3. Update state management to handle multiple indices
4. Test with mock data

### Phase 2: API Integration
1. Ensure API endpoints return correct data for both indices
2. Test synchronization between backend and frontend

### Phase 3: Frontend UI
1. Add BSE toggle switch
2. Implement timing display components
3. Create dual tile display logic
4. Add default day logic
5. Test UI interactions

### Phase 4: End-to-End Testing
1. Test with both indices enabled/disabled
2. Test default day switching
3. Verify timing accuracy
4. Test latency measurements
5. Validate backward compatibility

## Key Technical Details

### State Management
- Each index gets its own state machine within CasAutoTrade
- Shared settings but separate processing
- Independent latency tracking per index

### Timing Tracking
- Record timestamp when first indicative data is received
- Calculate latency as (first_indicative_time - request_start_time)
- Store and expose via API/snapshot

### Default Day Logic
- Get current day of week (0=Monday, 6=Sunday)
- If BSE enabled and day matches bse_default_days → use BSE
- If NSE enabled and day matches nse_default_days → use NSE
- If both enabled and day matches both → process both
- Allow manual override to force specific index

### UI Display
- When single index: current layout
- When both indices: side-by-side or stacked sections
- Each section shows its own indicative data, timing, latency
- Shared controls (lots, etc.) but index-specific displays