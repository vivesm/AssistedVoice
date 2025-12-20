# AssistedVoice Settings Enhancement TODO

## Overview
Systematic implementation of additional settings to make AssistedVoice more customizable and user-friendly.

---

## PHASE 1: Core AI Model Settings [HIGH PRIORITY]
### Goal: Give users control over AI behavior and response characteristics

#### 1.1 Temperature Control
- [ ] Add temperature slider to settings panel (0.0-1.0, step 0.1)
- [ ] Add label showing current value
- [ ] Create localStorage handler for temperature preference
- [ ] Add socket event 'update_temperature' in app.js
- [ ] Implement backend handler in web_assistant.py
- [ ] Update LLM modules to use dynamic temperature
- [ ] Add tooltip explaining temperature effect

#### 1.2 Max Tokens Control
- [ ] Add max tokens input field (50-2000 range)
- [ ] Add validation for min/max values
- [ ] Create localStorage handler for max_tokens
- [ ] Add socket event 'update_max_tokens' in app.js
- [ ] Implement backend handler in web_assistant.py
- [ ] Update LLM modules to use dynamic max_tokens
- [ ] Add character count estimate display

#### 1.3 System Prompt Customization
- [ ] Add expandable textarea for system prompt
- [ ] Add reset to default button
- [ ] Add prompt templates dropdown (Assistant, Technical, Creative, etc.)
- [ ] Create localStorage handler for system_prompt
- [ ] Add socket event 'update_system_prompt' in app.js
- [ ] Implement backend handler in web_assistant.py
- [ ] Update conversation manager to use custom prompt
- [ ] Add prompt preview/test button

---

## PHASE 2: Advanced Voice/TTS Settings [MEDIUM PRIORITY]
### Goal: Fine-tune voice output for better user experience

#### 2.1 TTS Speech Rate
- [ ] Add speech rate slider (50-300 WPM)
- [ ] Add speed indicator (Slow/Normal/Fast)
- [ ] Create localStorage handler for tts_rate
- [ ] Add socket event 'update_tts_rate' in app.js
- [ ] Implement backend handler for Edge TTS rate
- [ ] Implement backend handler for macOS TTS rate
- [ ] Add preview button to test rate

#### 2.2 TTS Volume Control
- [ ] Add volume slider (0-100%)
- [ ] Add mute/unmute toggle
- [ ] Create localStorage handler for tts_volume
- [ ] Add socket event 'update_tts_volume' in app.js
- [ ] Implement backend volume adjustment
- [ ] Add volume level indicator

#### 2.3 TTS Pitch Adjustment (Edge TTS)
- [ ] Add pitch slider (-50Hz to +50Hz)
- [ ] Show only when Edge TTS is selected
- [ ] Create localStorage handler for tts_pitch
- [ ] Add socket event 'update_tts_pitch' in app.js
- [ ] Implement backend pitch adjustment
- [ ] Add reset to normal button

#### 2.4 Enhanced Voice Selection
- [ ] Create comprehensive voice list for Edge TTS
- [ ] Add voice preview functionality
- [ ] Add voice categories (Male/Female/Child)
- [ ] Add language filter for voices
- [ ] Implement voice search/filter
- [ ] Add favorite voices feature
- [ ] Cache voice list for performance

---

## PHASE 3: UI/UX Enhancements [MEDIUM PRIORITY]
### Goal: Improve interface usability and customization

#### 3.1 Message Display Options
- [ ] Add "Show Timestamps" toggle
- [ ] Add "Show Latency Metrics" toggle  
- [ ] Add "Compact View" toggle
- [ ] Create localStorage handlers for display preferences
- [ ] Implement CSS classes for different view modes
- [ ] Add animation preferences toggle

#### 3.2 Auto-scroll Behavior
- [ ] Add "Auto-scroll to new messages" toggle
- [ ] Add "Pause auto-scroll on hover" option
- [ ] Add scroll-to-bottom button when not at bottom
- [ ] Create smart scroll detection
- [ ] Save scroll preference to localStorage

#### 3.3 Working Theme System
- [ ] Implement complete dark theme CSS
- [ ] Implement complete light theme CSS
- [ ] Add auto theme based on system preference
- [ ] Add theme transition animations
- [ ] Fix theme persistence on reload
- [ ] Add custom accent color picker

#### 3.4 Font Size Control
- [ ] Make font size slider functional
- [ ] Add preview text for font size
- [ ] Apply font size to all text elements
- [ ] Add zoom in/out buttons
- [ ] Save font size preference
- [ ] Add dyslexic-friendly font option

---

## PHASE 4: Voice Input Settings [LOW PRIORITY]
### Goal: Optimize voice detection for different environments

#### 4.1 VAD Configuration
- [ ] Add VAD aggressiveness slider (0-3)
- [ ] Add visual feedback for VAD level
- [ ] Create localStorage handler for vad_mode
- [ ] Add socket event 'update_vad_settings' in app.js
- [ ] Implement backend VAD adjustment
- [ ] Add environment presets (Quiet/Normal/Noisy)

#### 4.2 Silence Detection
- [ ] Add silence threshold slider
- [ ] Add speech timeout adjustment
- [ ] Add minimum speech duration setting
- [ ] Create visual audio level meter
- [ ] Add calibration wizard
- [ ] Show current audio level in real-time

#### 4.3 Microphone Settings
- [ ] Add input device selector dropdown
- [ ] Add microphone test button
- [ ] Add noise cancellation toggle
- [ ] Add gain control slider
- [ ] Show microphone status indicator
- [ ] Add permission check/request

---

## PHASE 5: Data Management Features [LOW PRIORITY]
### Goal: Give users control over their conversation data

#### 5.1 Export Functionality
- [ ] Add "Export Conversation" button
- [ ] Implement JSON export format
- [ ] Implement plain text export format
- [ ] Implement Markdown export format
- [ ] Add date range selector for export
- [ ] Add selective message export
- [ ] Create download functionality

#### 5.2 Data Management
- [ ] Add "Clear Current Chat" confirmation dialog
- [ ] Add "Clear All History" with double confirmation
- [ ] Add "Reset All Settings" option
- [ ] Implement settings export/import
- [ ] Add data statistics display
- [ ] Show storage usage

#### 5.3 Auto-save Configuration
- [ ] Add auto-save toggle
- [ ] Add save frequency selector
- [ ] Add conversation history limit
- [ ] Add data retention period setting
- [ ] Implement automatic cleanup
- [ ] Add backup/restore functionality

---

## PHASE 6: Performance & Advanced Settings [LOWEST PRIORITY]
### Goal: Provide power-user features and optimizations

#### 6.1 Streaming Configuration
- [ ] Add response streaming toggle
- [ ] Add chunk size adjustment
- [ ] Add stream buffer settings
- [ ] Show streaming status indicator
- [ ] Add fallback for streaming failures

#### 6.2 Caching System
- [ ] Add response cache toggle
- [ ] Add cache size limit setting
- [ ] Add cache clear button
- [ ] Show cache hit rate statistics
- [ ] Implement smart cache invalidation
- [ ] Add cache persistence option

#### 6.3 Connection Settings
- [ ] Add connection timeout adjustment
- [ ] Add retry attempts setting
- [ ] Add retry delay configuration
- [ ] Add connection quality indicator
- [ ] Add offline mode detection
- [ ] Add connection test tools

#### 6.4 Debug Options
- [ ] Add debug mode toggle
- [ ] Add console logging level selector
- [ ] Add performance metrics display
- [ ] Add network request inspector
- [ ] Add error reporting toggle
- [ ] Add diagnostic data export

---

## Implementation Notes

### For Each Setting:
1. **UI Component**: Add to settings panel with proper styling
2. **Event Handler**: Create JavaScript event listener
3. **Storage**: Implement localStorage save/load
4. **Socket Event**: Add bidirectional socket communication
5. **Backend Handler**: Process setting change on server
6. **Validation**: Add input validation and error handling
7. **Feedback**: Provide visual confirmation of changes
8. **Documentation**: Add tooltips and help text

### Testing Checklist:
- [ ] Setting persists after page reload
- [ ] Setting applies immediately without refresh
- [ ] Setting has appropriate min/max bounds
- [ ] Setting has sensible default value
- [ ] Setting change is visually confirmed
- [ ] Setting works across all browsers
- [ ] Setting handles edge cases gracefully

### Priority Order:
1. Start with Phase 1 (Core AI Settings) - Maximum impact
2. Then Phase 2 (Voice Settings) - High user value
3. Then Phase 3 (UI/UX) - Visible improvements
4. Phases 4-6 as time permits - Nice to have

### Branch Strategy:
- Create feature branch: `feature/enhanced-settings-v2`
- Implement one phase per PR for easier review
- Test thoroughly before merging each phase