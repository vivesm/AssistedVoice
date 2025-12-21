"""
Reading Mode WebSocket Handlers
To be integrated into routers/websocket.py
"""

# Add these handlers to the register_websocket_handlers function in websocket.py
# Place them before the final logger.info("✓ WebSocket handlers registered") line

# ==================== Reading Mode Handlers ====================

@sio.event
async def start_reading(sid, data):
    """Initialize reading session with text or share code"""
    try:
        mode = data.get('mode', 'text')  # 'text' or 'share'
        
        if mode == 'share':
            # Fetch content from share.vives.io
            share_code = data.get('share_code', '').strip()
            if not share_code:
                await sio.emit('reading_error', {'message': 'Share code is required'}, room=sid)
                return
            
            logger.info(f"Fetching share content for code: {share_code}")
            success, content = await _state['reading_service'].fetch_share_content(share_code)
            
            if not success:
                await sio.emit('reading_error', {'message': content}, room=sid)
                return
            
            text = content
            source = f"share:{share_code}"
            
        else:  # mode == 'text'
            text = data.get('text', '').strip()
            if not text:
                await sio.emit('reading_error', {'message': 'Text is required'}, room=sid)
                return
            source = "text"
        
        # Validate text length
        max_length = _state['reading_service'].max_text_length
        if len(text) > max_length:
            await sio.emit('reading_error', {
                'message': f'Text too large ({len(text)} chars). Maximum: {max_length}'
            }, room=sid)
            return
        
        # Create reading session
        try:
            session = _state['reading_service'].create_session(sid, text, source)
            
            # Send session info to client
            await sio.emit('reading_started', {
                'total_chunks': session['total_chunks'],
                'source': session['source'],
                'text_length': len(text)
            }, room=sid)
            
            # Send initial progress
            progress = _state['reading_service'].get_progress(sid)
            await sio.emit('reading_progress', progress, room=sid)
            
            logger.info(f"Reading session started for {sid}: {session['total_chunks']} chunks")
            
        except ValueError as e:
            await sio.emit('reading_error', {'message': str(e)}, room=sid)
            
    except Exception as e:
        logger.error(f"Error starting reading session: {e}")
        await sio.emit('reading_error', {'message': str(e)}, room=sid)

@sio.event
async def reading_play(sid, data=None):
    """Start or resume reading from current position"""
    try:
        session = _state['reading_service'].get_session(sid)
        if not session:
            await sio.emit('reading_error', {'message': 'No active reading session'}, room=sid)
            return
        
        # Set state to playing
        _state['reading_service'].set_state(sid, 'playing')
        
        # Get current chunk
        chunk = _state['reading_service'].get_current_chunk(sid)
        if not chunk:
            await sio.emit('reading_complete', {}, room=sid)
            _state['reading_service'].set_state(sid, 'stopped')
            return
        
        chunk_text = chunk['text']
        
        # Send chunk info
        progress = _state['reading_service'].get_progress(sid)
        await sio.emit('reading_chunk', {
            'text': chunk_text,
            'start_offset': chunk.get('start', 0),
            'end_offset': chunk.get('end', 0),
            'progress': progress
        }, room=sid)
        
        # Generate TTS if enabled
        if _state['config']['tts']['engine'] != 'none':
            if hasattr(_state['tts'], 'generate_audio_base64'):
                audio_data = await asyncio.to_thread(_state['tts'].generate_audio_base64, chunk_text)
                if audio_data:
                    await sio.emit('reading_audio', {'audio': audio_data}, room=sid)
            else:
                # Fallback to direct playback (not ideal for web)
                if hasattr(_state['tts'], 'speak_async'):
                    await asyncio.to_thread(_state['tts'].speak_async, chunk_text)
                else:
                    await asyncio.to_thread(_state['tts'].speak, chunk_text)
        
        logger.info(f"Playing chunk {progress['current_chunk']} for {sid}")
        
    except Exception as e:
        logger.error(f"Error playing reading: {e}")
        await sio.emit('reading_error', {'message': str(e)}, room=sid)

@sio.event
async def reading_pause(sid, data=None):
    """Pause reading at current position"""
    try:
        _state['reading_service'].set_state(sid, 'paused')
        await sio.emit('reading_paused', {}, room=sid)
        logger.info(f"Reading paused for {sid}")
    except Exception as e:
        logger.error(f"Error pausing reading: {e}")
        await sio.emit('reading_error', {'message': str(e)}, room=sid)

@sio.event
async def reading_stop(sid, data=None):
    """Stop reading and reset to beginning"""
    try:
        _state['reading_service'].reset_position(sid)
        await sio.emit('reading_stopped', {}, room=sid)
        
        # Send updated progress
        progress = _state['reading_service'].get_progress(sid)
        if progress:
            await sio.emit('reading_progress', progress, room=sid)
        
        logger.info(f"Reading stopped for {sid}")
    except Exception as e:
        logger.error(f"Error stopping reading: {e}")
        await sio.emit('reading_error', {'message': str(e)}, room=sid)

@sio.event
async def reading_next(sid, data=None):
    """Skip to next chunk"""
    try:
        next_chunk = _state['reading_service'].get_next_chunk(sid)
        
        if next_chunk is None:
            # Reached end
            await sio.emit('reading_complete', {}, room=sid)
            _state['reading_service'].set_state(sid, 'stopped')
        else:
            # Send updated progress
            progress = _state['reading_service'].get_progress(sid)
            await sio.emit('reading_progress', progress, room=sid)
            
            # If currently playing, play the new chunk
            session = _state['reading_service'].get_session(sid)
            if session and session['state'] == 'playing':
                await reading_play(sid)
        
        logger.info(f"Skipped to next chunk for {sid}")
        
    except Exception as e:
        logger.error(f"Error skipping to next chunk: {e}")
        await sio.emit('reading_error', {'message': str(e)}, room=sid)

@sio.event
async def reading_previous(sid, data=None):
    """Go back to previous chunk"""
    try:
        prev_chunk = _state['reading_service'].get_previous_chunk(sid)
        
        if prev_chunk is None:
            # Already at beginning
            await sio.emit('reading_error', {'message': 'Already at beginning'}, room=sid)
        else:
            # Send updated progress
            progress = _state['reading_service'].get_progress(sid)
            await sio.emit('reading_progress', progress, room=sid)
            
            # If currently playing, play the new chunk
            session = _state['reading_service'].get_session(sid)
            if session and session['state'] == 'playing':
                await reading_play(sid)
        
        logger.info(f"Went back to previous chunk for {sid}")
        
    except Exception as e:
        logger.error(f"Error going to previous chunk: {e}")
        await sio.emit('reading_error', {'message': str(e)}, room=sid)

@sio.event
async def reading_seek(sid, data):
    """Seek to specific chunk index"""
    try:
        chunk_index = data.get('chunk_index', 0)
        chunk_text = _state['reading_service'].seek_to_chunk(sid, chunk_index)
        
        if chunk_text is None:
            await sio.emit('reading_error', {'message': 'Invalid chunk index'}, room=sid)
        else:
            # Send updated progress
            progress = _state['reading_service'].get_progress(sid)
            await sio.emit('reading_progress', progress, room=sid)
            
            # If currently playing, play the new chunk
            session = _state['reading_service'].get_session(sid)
            if session and session['state'] == 'playing':
                await reading_play(sid)
        
        logger.info(f"Seeked to chunk {chunk_index} for {sid}")
        
    except Exception as e:
        logger.error(f"Error seeking: {e}")
        await sio.emit('reading_error', {'message': str(e)}, room=sid)

@sio.event
async def reading_auto_advance(sid, data=None):
    """Auto-advance to next chunk (called when TTS completes)"""
    try:
        session = _state['reading_service'].get_session(sid)
        if not session or session['state'] != 'playing':
            return
        
        # Move to next chunk
        next_chunk = _state['reading_service'].get_next_chunk(sid)
        
        if next_chunk is None:
            # Reached end
            await sio.emit('reading_complete', {}, room=sid)
            _state['reading_service'].set_state(sid, 'stopped')
        else:
            # Auto-play next chunk
            await reading_play(sid)
        
    except Exception as e:
        logger.error(f"Error auto-advancing: {e}")
        await sio.emit('reading_error', {'message': str(e)}, room=sid)

@sio.event
async def end_reading(sid, data=None):
    """End reading session and clean up"""
    try:
        _state['reading_service'].delete_session(sid)
        await sio.emit('reading_ended', {}, room=sid)
        logger.info(f"Reading session ended for {sid}")
    except Exception as e:
        logger.error(f"Error ending reading session: {e}")
        await sio.emit('reading_error', {'message': str(e)}, room=sid)
