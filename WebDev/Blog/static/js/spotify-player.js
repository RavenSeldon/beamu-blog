class SpotifyWebPlayer {
    constructor() {
        this.player = null;
        this.deviceId = null;
        this.accessToken = null;
        this.isReady = false;
        this.currentTrack = null;
        this.isPlaying = false;
        this.position = 0;
        this.duration = 0;
        this.progressInterval = null;
        this.stateCheckInterval = null;
        this.saveStateTimeout = null;
        this.currentContext = null; // Track the current playback context { uri: string, type: 'album' | 'playlist' | 'artist' | 'unknown' }
        this.isRestoringState = false; // Flag to prevent multiple restore attempts

        // UI Elements
        this.connectBtn = null;
        this.playerContainer = null;
        this.trackNameEl = null;
        this.artistNameEl = null;
        this.albumArtEl = null;
        this.playPauseBtn = null;
        this.prevBtn = null;
        this.nextBtn = null;
        this.progressBar = null;
        this.progressFill = null;
        this.currentTimeEl = null;
        this.durationEl = null;

        this.init();
    }

    init() {
        document.addEventListener('DOMContentLoaded', () => {
            this.initUI();
            this.checkStoredTokens();

            if (window.Spotify) {
                this.initSpotifySDK();
            } else {
                window.onSpotifyWebPlaybackSDKReady = () => {
                    this.initSpotifySDK();
                };
            }
        });

        // Save state before page unload
        window.addEventListener('beforeunload', () => {
            // Save state only if not in the middle of restoring
            if (!this.isRestoringState) {
                this.savePlaybackState();
            }
        });

        // Periodic save as a fallback, ensure not to run during restoration
        setInterval(() => {
            if (this.isReady && this.currentTrack && !this.isRestoringState) {
                this.savePlaybackState();
            }
        }, 5000); // Save every 5 seconds
    }

    initUI() {
        // Get UI elements
        this.connectBtn = document.getElementById('visitor-spotify-connect-button');
        this.playerContainer = document.getElementById('persistent-music-player');
        this.trackNameEl = document.getElementById('player-track-name');
        this.artistNameEl = document.getElementById('player-artist-name');
        this.albumArtEl = document.getElementById('player-album-art');
        this.playPauseBtn = document.getElementById('player-play-pause-btn');
        this.prevBtn = document.getElementById('player-prev-btn');
        this.nextBtn = document.getElementById('player-next-btn');
        this.progressBar = document.querySelector('.player-progress-bar');
        this.progressFill = document.getElementById('player-progress-fill');
        this.currentTimeEl = document.getElementById('player-current-time');
        this.durationEl = document.getElementById('player-duration');

        if (this.connectBtn) this.connectBtn.addEventListener('click', () => this.initiateSpotifyAuth());
        if (this.playPauseBtn) this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        if (this.prevBtn) this.prevBtn.addEventListener('click', () => this.previousTrack());
        if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.nextTrack());
        if (this.progressBar) this.progressBar.addEventListener('click', (e) => this.seekToPosition(e));

        const musicPageBtn = document.getElementById('player-music-page-btn');
        if (musicPageBtn) musicPageBtn.addEventListener('click', () => { window.location.href = '/music'; });

        const disconnectBtn = document.getElementById('player-disconnect-btn');
        if (disconnectBtn) disconnectBtn.addEventListener('click', () => { if (confirm('Are you sure you want to disconnect from Spotify?')) this.disconnectSpotify(); });

        window.spotifyCallbackSuccess = () => { console.log('Spotify auth successful, checking tokens...'); setTimeout(() => this.checkStoredTokens(), 1000); };
        window.spotifyCallbackError = (error) => { console.error('Spotify auth error:', error); this.showConnectButton(); };
        if (localStorage.getItem('spotify_auth_just_completed') === 'true') { localStorage.removeItem('spotify_auth_just_completed'); setTimeout(() => this.checkStoredTokens(), 500); }
    }

    showLoadingState() {
        if (this.playerContainer) this.playerContainer.classList.add('reconnecting');
        if (this.trackNameEl) this.trackNameEl.textContent = 'Reconnecting...';
        if (this.artistNameEl) this.artistNameEl.textContent = 'Restoring playback state';
    }

    hideLoadingState() {
        if (this.playerContainer) this.playerContainer.classList.remove('reconnecting');
    }

    showStatusMessage(message, type = 'info') {
        const existing = document.querySelector('.spotify-status-message');
        if (existing) existing.remove();
        const messageEl = document.createElement('div');
        messageEl.className = `spotify-status-message ${type}`;
        messageEl.textContent = message;
        document.body.appendChild(messageEl);
        setTimeout(() => messageEl.classList.add('show'), 100);
        setTimeout(() => { messageEl.classList.remove('show'); setTimeout(() => messageEl.remove(), 300); }, 3000);
    }

    savePlaybackState() {
        if (!this.isReady || !this.currentTrack || this.isRestoringState) {
            // console.log('Conditions not met for saving state, or restoring in progress.');
            return;
        }

        const state = {
            currentTrack: {
                uri: this.currentTrack.uri,
                name: this.currentTrack.name,
                artists: this.currentTrack.artists,
                album: this.currentTrack.album,
                duration_ms: this.currentTrack.duration_ms
            },
            isPlaying: this.isPlaying,
            position: this.position,
            duration: this.currentTrack.duration_ms, // Ensure this is from the track itself
            timestamp: Date.now(),
            currentContext: this.currentContext
        };

        localStorage.setItem('spotify_playback_state', JSON.stringify(state));
        console.log('Saved playback state:', state);
    }

    async restorePlaybackState() {
        const savedStateJSON = localStorage.getItem('spotify_playback_state');
        if (!savedStateJSON) {
            console.log('No saved playback state found.');
            this.isRestoringState = false;
            return;
        }

        if (this.isRestoringState) {
            console.log("Restoration already in progress.");
            return;
        }

        this.isRestoringState = true;
        this.showLoadingState();

        try {
            const state = JSON.parse(savedStateJSON);
            const timeSinceSave = Date.now() - state.timestamp;

            if (timeSinceSave > 30 * 60 * 1000) { // 30 minutes expiry
                console.log('Saved state too old, not restoring');
                localStorage.removeItem('spotify_playback_state');
                this.hideLoadingState();
                this.isRestoringState = false;
                return;
            }

            console.log('Attempting to restore playback state:', state);

            this.currentTrack = state.currentTrack;
            this.duration = state.currentTrack.duration_ms; // Use track's duration
            this.currentContext = state.currentContext || null;

            if (state.isPlaying) {
                // Adjust position for time passed only if it was playing, but don't exceed duration
                this.position = Math.min(state.position + timeSinceSave, this.duration);
                this.isPlaying = true;
            } else {
                this.position = state.position;
                this.isPlaying = false;
            }

            this.updateUI();
            this.showPlayer();

            const transferred = await this.transferPlayback(state.isPlaying); // Pass play state to transfer

            await new Promise(resolve => setTimeout(resolve, transferred ? 1000 : 500)); // Shorter delay, or slightly longer if transfer happened

            let restoredSuccessfully = false;
            if (this.currentContext && this.currentContext.uri && state.currentTrack && state.currentTrack.uri) {
                console.log('Attempting to restore with context:', this.currentContext.uri, 'track:', state.currentTrack.uri);
                restoredSuccessfully = await this.resumeWithContext(this.currentContext, state.currentTrack.uri, this.position);
            }

            if (!restoredSuccessfully && state.currentTrack && state.currentTrack.uri) {
                console.log('Context restore failed or no context, attempting to restore single track:', state.currentTrack.uri);
                restoredSuccessfully = await this.resumeTrackFromPosition(state.currentTrack.uri, this.position);
            }

            if (restoredSuccessfully) {
                if (!state.isPlaying) {
                    setTimeout(async () => {
                        if (this.player) {
                           await this.player.pause();
                           this.isPlaying = false;
                           this.updateUI();
                           console.log("Playback restored to paused state.");
                        }
                    }, 1500);
                }
                this.showStatusMessage('Playback restored successfully!', 'success');
                localStorage.removeItem('spotify_playback_state');
            } else {
                console.error('Failed to restore playback via context or single track.');
                this.showStatusMessage('Could not restore previous session.', 'error');
                localStorage.removeItem('spotify_playback_state');
            }

        } catch (error) {
            console.error('Critical error restoring playback state:', error);
            localStorage.removeItem('spotify_playback_state');
            this.showStatusMessage('Error restoring session. Starting fresh.', 'error');
        } finally {
            this.hideLoadingState();
            this.isRestoringState = false;
        }
    }

    async resumeWithContext(context, trackUri, positionMs) {
        if (!this.player || !this.isReady || !this.accessToken || !this.deviceId) {
            console.warn('Player not ready, no token, or no device ID for resumeWithContext.');
            return false;
        }
        if (!context || !context.uri) {
            console.warn('resumeWithContext called without a valid context URI.');
            return false;
        }

        try {
            const body = {
                context_uri: context.uri,
                position_ms: Math.max(0, Math.floor(positionMs))
            };

            if (trackUri) {
                if (context.type === 'album') {
                    const trackId = trackUri.split(':').pop();
                    const albumId = context.uri.split(':').pop();

                    console.log(`Workspaceing tracks for album ${albumId} to find index for track ${trackId}`);
                    const albumResponse = await fetch(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`, {
                        headers: { 'Authorization': `Bearer ${this.accessToken}` }
                    });

                    if (albumResponse.ok) {
                        const albumData = await albumResponse.json();
                        const trackIndex = albumData.items.findIndex(t => t.id === trackId || t.uri === trackUri);
                        if (trackIndex !== -1) {
                            body.offset = { position: trackIndex };
                            console.log(`Offset for album: position ${trackIndex}`);
                        } else {
                            console.warn(`Track URI ${trackUri} not found in album ${context.uri}. Playback will start from the beginning of the album at the specified position.`);
                        }
                    } else {
                        console.warn(`Failed to fetch album tracks for ${context.uri}. Playback might start from the beginning of the album.`);
                    }
                } else if (context.type === 'playlist') {
                    body.offset = { uri: trackUri }; // Crucial for playlists
                    console.log(`Offset for playlist: uri ${trackUri}`);
                } else {
                    console.log(`Context type ${context.type} does not support specific track offset in this implementation. Playing context from start.`);
                }
            }

            console.log('Resuming with context - Play API Body:', body);
            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (response.ok || response.status === 204) {
                console.log('Successfully resumed playback with context.');
                return true;
            } else {
                const errorText = await response.text();
                console.error('Failed to resume with context:', response.status, errorText);
                return false;
            }
        } catch (error) {
            console.error('Error in resumeWithContext:', error);
            return false;
        }
    }

    async syncWithSpotifyState() {
        if (!this.accessToken || this.isRestoringState) return;
        try {
            const response = await fetch('https://api.spotify.com/v1/me/player', { headers: { 'Authorization': `Bearer ${this.accessToken}` }});
            if (response.status === 200) {
                const spotifyState = await response.json();
                if (spotifyState && spotifyState.item) {
                    console.log('Synced with Spotify state:', spotifyState);
                    this.currentTrack = { uri: spotifyState.item.uri, name: spotifyState.item.name, artists: spotifyState.item.artists, album: spotifyState.item.album, duration_ms: spotifyState.item.duration_ms };
                    this.isPlaying = spotifyState.is_playing;
                    this.position = spotifyState.progress_ms;
                    this.duration = spotifyState.item.duration_ms;
                    if (spotifyState.context && spotifyState.context.uri) {
                        let type = 'unknown';
                        if (spotifyState.context.uri.includes(':album:')) type = 'album';
                        else if (spotifyState.context.uri.includes(':playlist:')) type = 'playlist';
                        else if (spotifyState.context.uri.includes(':artist:')) type = 'artist';
                        this.currentContext = { type: type, uri: spotifyState.context.uri };
                    } else {
                        this.currentContext = null;
                    }
                    this.updateUI();
                    if (this.isPlaying) this.startProgressTimer(); else this.stopProgressTimer();
                }
            } else if (response.status === 204) { console.log('No active Spotify playback for sync.'); }
        } catch (error) { console.error('Error syncing with Spotify state:', error); }
    }

    async resumeTrackFromPosition(uri, positionMs) {
        if (!this.player || !this.isReady || !this.accessToken || !this.deviceId) { console.warn('Player not ready for resumeTrackFromPosition.'); return false; }
        try {
            console.log(`Resuming single track ${uri} from position ${positionMs}ms`);
            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.floor(positionMs)) })
            });
            if (response.ok || response.status === 204) { console.log('Successfully resumed single track playback.'); return true; }
            else {
                const errorText = await response.text(); console.error('Failed to resume single track:', response.status, errorText);
                if (response.status === 404) { if (await this.transferPlayback(true)) { await new Promise(r => setTimeout(r, 1000)); return await this.resumeTrackFromPosition(uri, positionMs); } }
                return false;
            }
        } catch (error) { console.error('Error resuming single track:', error); return false; }
    }

    checkStoredTokens() {
        const accessToken = localStorage.getItem('visitor_spotify_access_token');
        const expiresAt = localStorage.getItem('visitor_spotify_token_expires_at');
        if (accessToken && expiresAt) {
            if (new Date().getTime() < parseInt(expiresAt)) { this.accessToken = accessToken; this.initSpotifySDK(); return; }
            else { this.refreshAccessToken(); return; }
        }
        this.showConnectButton();
    }
    async refreshAccessToken() {
        const refreshToken = localStorage.getItem('visitor_spotify_refresh_token');
        if (!refreshToken) { this.showConnectButton(); return; }
        try {
            const response = await fetch('/api/spotify/refresh-visitor-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            localStorage.setItem('visitor_spotify_access_token', data.access_token);
            localStorage.setItem('visitor_spotify_token_expires_at', (new Date().getTime() + (data.expires_in * 1000)).toString());
            if (data.refresh_token) localStorage.setItem('visitor_spotify_refresh_token', data.refresh_token);
            this.accessToken = data.access_token; this.initSpotifySDK();
        } catch (error) { console.error('Error refreshing token:', error); this.clearStoredTokens(); this.showConnectButton(); }
    }
    clearStoredTokens() {
        localStorage.removeItem('visitor_spotify_access_token');
        localStorage.removeItem('visitor_spotify_refresh_token');
        localStorage.removeItem('visitor_spotify_token_expires_at');
        localStorage.removeItem('spotify_playback_state');
    }
    disconnectSpotify() {
        if (this.isPlaying && this.player) this.player.pause();
        if (this.player) this.player.disconnect();
        this.clearStoredTokens();
        this.player = null; this.deviceId = null; this.accessToken = null; this.isReady = false; this.currentTrack = null; this.isPlaying = false; this.position = 0; this.duration = 0; this.currentContext = null;
        this.stopProgressTimer(); this.stopStateCheck();
        if (this.playerContainer) this.playerContainer.style.display = 'none';
        this.showConnectButton(); this.showStatusMessage('Disconnected from Spotify', 'info');
    }
    showConnectButton() { if (this.connectBtn) this.connectBtn.style.display = 'block'; if (this.playerContainer) this.playerContainer.style.display = 'none';}
    hideConnectButton() { if (this.connectBtn) this.connectBtn.style.display = 'none'; }
    showPlayer() { if (this.playerContainer) { this.playerContainer.style.display = 'flex'; this.playerContainer.style.animation = 'slideUpPlayer 0.5s ease-out';} this.hideConnectButton(); }
    initiateSpotifyAuth() {
        const authUrl = '/spotify/initiate-auth'; const popup = window.open(authUrl, 'spotify-auth', 'width=500,height=600,scrollbars=yes,resizable=yes');
        const checkClosed = setInterval(() => { if (!popup || popup.closed) { clearInterval(checkClosed); setTimeout(() => this.checkStoredTokens(), 1000);}}, 1000);
    }

    initSpotifySDK() {
        if (!this.accessToken || !window.Spotify) { console.log('Cannot init SDK - no token or SDK not loaded'); return; }
        console.log('Initializing Spotify Web Playback SDK...');
        this.player = new Spotify.Player({ name: 'Ben\'s Neurascape Web Player', getOAuthToken: (cb) => { cb(this.accessToken); }, volume: 0.5 });

        this.player.addListener('initialization_error', ({ message }) => console.error('SDK Init Error:', message));
        this.player.addListener('authentication_error', ({ message }) => { console.error('SDK Auth Error:', message); this.refreshAccessToken(); });
        this.player.addListener('account_error', ({ message }) => { console.error('SDK Account Error:', message); this.showStatusMessage('Spotify account error. Premium might be required.', 'error');});
        this.player.addListener('playback_error', ({ message }) => { console.error('SDK Playback Error:', message); if (!message.includes('no list was loaded')) this.showStatusMessage('Playback error: ' + message, 'error');});

        this.player.addListener('player_state_changed', (state) => {
            console.log('Player state changed:', state);
            if (!state || this.isRestoringState) { console.log('No state or restoring, skipping update.'); return; }

            this.currentTrack = state.track_window.current_track;
            this.isPlaying = !state.paused;
            this.position = state.position;
            this.duration = state.duration; // SDK provides duration of current track

            if (state.context && state.context.uri) {
                let type = 'unknown';
                const uri = state.context.uri;
                if (uri.includes(':album:')) type = 'album';
                else if (uri.includes(':playlist:')) type = 'playlist';
                else if (uri.includes(':artist:')) type = 'artist';
                // Add more types if needed, e.g., show, episode
                this.currentContext = { type: type, uri: uri };
            } else {
                this.currentContext = null;
            }

            console.log('Internal state updated:', { track: this.currentTrack?.name, context: this.currentContext, isPlaying: this.isPlaying });
            this.updateUI();
            if (this.isPlaying) this.startProgressTimer(); else this.stopProgressTimer();

            clearTimeout(this.saveStateTimeout);
            this.saveStateTimeout = setTimeout(() => {
                if (!this.isRestoringState) this.savePlaybackState();
            }, 1000);
        });

        this.player.addListener('ready', async ({ device_id }) => {
            console.log('Spotify Player Ready with Device ID:', device_id);
            this.deviceId = device_id;
            this.isReady = true;
            this.showPlayer();
            document.dispatchEvent(new Event('spotifyPlayerReady'));

            await this.restorePlaybackState();

            this.startStateCheck();
        });

        this.player.addListener('not_ready', ({ device_id }) => { console.log('Device Not Ready:', device_id); this.isReady = false; this.stopStateCheck();});
        this.player.connect().then(success => { if (success) console.log('SDK connected.'); else { console.error('SDK failed to connect.'); this.showStatusMessage('Failed to connect to Spotify', 'error');}});
    }

    startStateCheck() { this.stopStateCheck(); this.stateCheckInterval = setInterval(() => { if (!this.isRestoringState) this.syncWithSpotifyState(); }, 30000); }
    stopStateCheck() { if (this.stateCheckInterval) { clearInterval(this.stateCheckInterval); this.stateCheckInterval = null; } }
    startProgressTimer() { this.stopProgressTimer(); this.progressInterval = setInterval(() => { if (this.isPlaying && this.duration > 0) { this.position += 1000; if (this.position > this.duration) this.position = this.duration; this.updateProgress();}}, 1000); }
    stopProgressTimer() { if (this.progressInterval) { clearInterval(this.progressInterval); this.progressInterval = null; }}

    updateUI() {
        if (!this.currentTrack) return;
        if (this.trackNameEl) { this.trackNameEl.textContent = this.currentTrack.name; /* ... animation ... */ }
        if (this.artistNameEl) this.artistNameEl.textContent = this.currentTrack.artists.map(a => a.name).join(', ');
        if (this.albumArtEl && this.currentTrack.album?.images?.[0]?.url) this.albumArtEl.src = this.currentTrack.album.images[0].url;
        if (this.playPauseBtn) { const i = this.playPauseBtn.querySelector('i'); if(i) i.className = this.isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'; this.playPauseBtn.title = this.isPlaying ? 'Pause':'Play';}
        this.duration = this.currentTrack.duration_ms;
        this.updateProgress();
    }
    updateProgress() { if (this.duration > 0) { const p = (this.position / this.duration) * 100; if(this.progressFill) this.progressFill.style.width = `${p}%`; if(this.currentTimeEl) this.currentTimeEl.textContent = this.formatTime(this.position); if(this.durationEl) this.durationEl.textContent = this.formatTime(this.duration); } else { if(this.progressFill) this.progressFill.style.width = '0%'; if(this.currentTimeEl) this.currentTimeEl.textContent = '0:00'; if(this.durationEl) this.durationEl.textContent = '0:00';}}
    formatTime(ms) { const s = Math.floor(ms/1000); const m = Math.floor(s/60); const rs = s % 60; return `${m}:${rs.toString().padStart(2,'0')}`; }
    seekToPosition(e) { if (!this.player || !this.isReady || !this.duration) return; const r=this.progressBar.getBoundingClientRect(); const p=(e.clientX-r.left)/r.width; this.player.seek(Math.floor(p*this.duration)).catch(err => console.error('Seek err:',err));}

    async togglePlayPause() {
        if (!this.player || !this.isReady) return;
        try { if (this.isPlaying) await this.player.pause(); else { const ctx = await this.getCurrentPlaybackContext(); if (!ctx || !ctx.item) { this.showStatusMessage('No track loaded.', 'error'); return; } await this.player.resume();}}
        catch (error) { console.error('Toggle err:', error); this.handlePlaybackError(error, 'togglePlayPause'); setTimeout(() => this.syncWithSpotifyState(), 1000); }
    }
    async previousTrack() {
        if (!this.player || !this.isReady || !this.accessToken) return;
        try { if (!(await this.ensureDeviceActive())) {this.showStatusMessage('Player device not active','error'); return;}
            const r = await fetch('https://api.spotify.com/v1/me/player/previous',{method:'POST',headers:{'Authorization':`Bearer ${this.accessToken}`}});
            if (r.ok || r.status === 204) { setTimeout(()=>this.syncWithSpotifyState(), 500); }
            else if (r.status === 404) { await this.transferPlayback(true); setTimeout(()=>this.previousTrack(), 1000); }
            else if (r.status === 403) { this.showStatusMessage('No previous track.', 'info'); }
            else { this.showStatusMessage('Cannot go to previous track.', 'error');}
        } catch (e) { console.error('Prev track err:',e); this.showStatusMessage('Error changing track.','error');}
    }
    async nextTrack() {
        if (!this.player || !this.isReady || !this.accessToken) return;
        try { if (!(await this.ensureDeviceActive())) {this.showStatusMessage('Player device not active','error'); return;}
            const r = await fetch('https://api.spotify.com/v1/me/player/next',{method:'POST',headers:{'Authorization':`Bearer ${this.accessToken}`}});
            if (r.ok || r.status === 204) { setTimeout(()=>this.syncWithSpotifyState(), 500); }
            else if (r.status === 404) { await this.transferPlayback(true); setTimeout(()=>this.nextTrack(), 1000); }
            else if (r.status === 403) { this.showStatusMessage('No next track.', 'info'); }
            else { this.showStatusMessage('Cannot go to next track.', 'error');}
        } catch (e) { console.error('Next track err:',e); this.showStatusMessage('Error changing track.','error');}
    }

    async playTrack(uri) {
        if (!this.player || !this.isReady || !this.accessToken || !this.deviceId) { this.showStatusMessage('Player not ready.', 'error'); return; }
        try {
            console.log('playTrack called with URI:', uri);
            await this.transferPlayback(true);
            await new Promise(resolve => setTimeout(resolve, 300));

            const trackId = uri.split(':').pop();
            let playbackBody = { uris: [uri] };
            this.currentContext = null;

            const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, { headers: { 'Authorization': `Bearer ${this.accessToken}` } });
            if (trackResponse.ok) {
                const trackData = await trackResponse.json();
                if (trackData.album && trackData.album.uri) { // Always prefer album context if available
                    playbackBody = { context_uri: trackData.album.uri, offset: { uri: uri } };
                    this.currentContext = { type: 'album', uri: trackData.album.uri };
                    console.log(`Playing track within album context: ${trackData.album.uri}`);
                }
            } else {
                console.warn('Could not fetch track details to determine album context. Playing as single track.');
            }

            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(playbackBody)
            });
            if (!response.ok && response.status !== 204) { const err = await response.text(); throw new Error(`Playback API error: ${response.status} ${err}`); }
            this.showStatusMessage('Starting playback...', 'success');
        } catch (error) { console.error('Error in playTrack:', error); this.showStatusMessage(`Failed to play track: ${error.message}`, 'error'); }
    }

    async playContext(contextUri, offset = 0) {
        if (!this.player || !this.isReady || !this.accessToken || !this.deviceId) { this.showStatusMessage('Player not ready.', 'error'); return; }
        try {
            console.log('playContext called with URI:', contextUri, "Offset:", offset);
            await this.transferPlayback(true);
            await new Promise(resolve => setTimeout(resolve, 300));

            const body = { context_uri: contextUri };
            // Handle both numeric offset (for albums generally) and URI offset (for playlists/tracks in albums)
            if (typeof offset === 'number' && offset >= 0) { // Ensure offset is not negative
                body.offset = { position: offset };
            } else if (typeof offset === 'string' && offset.startsWith('spotify:track:')) {
                body.offset = { uri: offset };
            }

            let contextType = 'unknown';
            if (contextUri.includes(':album:')) contextType = 'album';
            else if (contextUri.includes(':playlist:')) contextType = 'playlist';
            this.currentContext = { type: contextType, uri: contextUri };

            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!response.ok && response.status !== 204) { const err = await response.text(); throw new Error(`Playback API error: ${response.status} ${err}`); }
            this.showStatusMessage('Starting playback...', 'success');
        } catch (error) { console.error('Error in playContext:', error); this.showStatusMessage(`Failed to play: ${error.message}`, 'error');}
    }

    async transferPlayback(play = false) {
        if (!this.deviceId || !this.accessToken) { console.warn('Cannot transfer playback: no device ID or token.'); return false; }
        try {
            console.log(`Transferring playback to ${this.deviceId}, play: ${play}`);
            const response = await fetch('https://api.spotify.com/v1/me/player', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_ids: [this.deviceId], play: play })
            });
            if (response.ok || response.status === 204) { console.log('Playback transferred.'); return true; }
            else { console.error('Failed to transfer playback:', response.status, await response.text()); return false; }
        } catch (error) { console.error('Error transferring playback:', error); return false; }
    }

    async ensureDeviceActive() {
        if (!this.deviceId || !this.accessToken) return false;
        try {
            const r = await fetch('https://api.spotify.com/v1/me/player',{headers:{'Authorization':`Bearer ${this.accessToken}`}});
            if (r.status === 200) { const s = await r.json(); if (s.device && s.device.id === this.deviceId && s.device.is_active) return true; }
            console.log('Device not active or not this one, transferring...');
            return await this.transferPlayback(this.isPlaying);
        } catch (e) { console.error('Err ensureDeviceActive:',e); return false;}
    }
    async handlePlaybackError(error, context = '') { console.error(`Playback error in ${context}:`, error); if (error.message?.includes('404')) this.showStatusMessage('No active playback. Play a track first.','error'); else if (error.message?.includes('403')) this.showStatusMessage('Premium required for this feature.','error'); else this.showStatusMessage(`Playback error: ${error.message || 'Unknown'}`,'error');}
    async addToQueue(uri) { if(!this.accessToken)return false; try{const r=await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`,{method:'POST',headers:{'Authorization':`Bearer ${this.accessToken}`}}); if(r.ok||r.status===204)return true; else return false;}catch(e){return false;}}
    async getCurrentPlaybackContext() { if(!this.accessToken)return null; try{const r=await fetch('https://api.spotify.com/v1/me/player',{headers:{'Authorization':`Bearer ${this.accessToken}`}}); if(r.ok)return await r.json(); return null;}catch(e){return null;}}

    disconnect() {
        this.stopProgressTimer();
        this.stopStateCheck();
        if (!this.isRestoringState) {
             this.savePlaybackState();
        }
        if (this.player) {
            this.player.disconnect();
            console.log("Spotify Player instance disconnected.");
        }
        this.isReady = false;
    }
}

window.spotifyPlayer = new SpotifyWebPlayer();

window.addEventListener('unload', () => {
    if (window.spotifyPlayer) {
        window.spotifyPlayer.disconnect();
    }
});