# Enhancement Plan: BSE SENSEX Support for CAS Auto Trade

## Overview
Add BSE SENSEX indicative close support to the CAS Auto Trade feature alongside existing NSE NIFTY support, with configurable scheduling and dual-display capabilities.

## Changes Required

### 1. Backend Changes
#### a. Create BSE Indicative Provider (`backend/cas_indicative_bse.py`)
- Similar structure to `cas_indicative_nse.py`
- Investigate BSE API endpoints for indicative close
- Implement cookie warmup and JSON parsing for BSE
- Handle BSE-specific timing and validation

#### b. Update CAS Bridge (`backend/cas_bridge.py`)
- Add BSE configuration options:
  - `bse_enabled`: Boolean toggle for BSE support
  - `bse_default_days`: Configuration for default days (Mon/Tue=NSE, Wed/Thu=BSE)
  - `bse_poll_ms`: Polling interval for BSE
- Update settings schema to include BSE options

#### c. Enhance Auto Trade Logic (`backend/cas_auto_trade.py`)
- Make index selection configurable (NIFTY/SENSEX/BOTH)
- Support dual-index processing when both enabled
- Track first pickup time for each index to calculate latency
- Handle separate decision logic for each index

#### d. Update API Endpoints
- Modify `/cas/status` to return BSE data when enabled
- Update `/cas/settings` to accept BSE configuration
- Add BSE-specific endpoints if needed

### 2. Frontend Changes
#### a. Update CAS Panel (`frontend/src/components/CasPanel.jsx`)
- Add BSE enable/disable toggle in settings
- Display timing information for first pickup of indicative data
- Show dual tiles when both NSE and BSE are enabled
- Display latency measurements for each index
- Update default day logic (NSE: Mon/Tue, BSE: Wed/Thu)

#### b. Update Utilities
- Modify `ALL_INDEXES` logic to be configurable based on BSE enabled state
- Update formatting functions to handle BSE data

### 3. Configuration
- Add BSE settings to admin configuration
- Persist BSE preferences in user settings/localStorage
- Default BSE to disabled for backward compatibility

## Implementation Details

### BSE Indicative Provider
- Research BSE endpoints similar to NSE's:
  - `/api/NextApi/apiClient?functionName=getIndexData&&type=ALL`
  - `/api/allIndices`
  - `/api/marketStatus`
- Implement equivalent BSE endpoints if available
- Fallback to HTML scraping if no JSON API exists
- Implement proper error handling and validation

### Dual Index Processing
- When both indices enabled:
  - Process NSE and BSE in parallel
  - Maintain separate state machines for each
  - Show independent latency measurements
  - Display combined UI with separate sections
- When only one enabled:
  - Maintain current single-index behavior
  - Show only that index's data

### Timing and Latency Tracking
- Record timestamp when first indicative data is received for each index
- Calculate latency as: (first_indicative_time - request_start_time)
- Display this latency in the UI for user feedback
- Use this to optimize polling intervals if needed

### Default Day Logic
- Implement schedule: 
  - Monday/Tuesday: NSE NIFTY (default)
  - Wednesday/Thursday: BSE SENSEX (default)
  - Friday: User preference or both
  - Weekend/Holiday: Based on user configuration
- Allow override via admin settings

## Files to Modify/Create
1. `backend/cas_indicative_bse.py` (new)
2. `backend/cas_bridge.py` (modify)
3. `backend/cas_auto_trade.py` (modify)
4. `frontend/src/components/CasPanel.jsx` (modify)
5. `backend/server.py` (may need API route updates)
6. `backend/cas_rule_expiry_automation/config.py` (may need settings updates)

## Testing Strategy
1. Unit tests for BSE indicative provider
2. Integration tests for dual-index processing
3. UI tests for timing display and toggle functionality
4. End-to-end testing with mock BSE/NSE data
5. Verify backward compatibility when BSE disabled

## Dependencies
- May need additional HTTP client libraries if BSE requires different handling
- Potential need for CORS handling if BSE API has restrictions
- Timezone utilities for IST conversion (already present)

## Risks and Mitigations
1. **BSE API Unavailable**: Mitigation - Implement fallback to HTML scraping with proper headers
2. **Increased Load**: Mitigation - Allow configurable polling intervals, optimize parallel processing
3. **UI Complexity**: Mitigation - Collapsible sections, clear labeling, default to NSE-only view
4. **Configuration Conflicts**: Mitigation - Clear documentation, validation in settings API

## Rollout Plan
1. Implement BSE indicative provider in isolation
2. Add configuration hooks without enabling by default
3. Implement UI toggle and display logic
4. Add dual-index processing logic
5. Add timing/latency tracking
6. Implement default day scheduling
7. Comprehensive testing
8. Gradual rollout via feature flags