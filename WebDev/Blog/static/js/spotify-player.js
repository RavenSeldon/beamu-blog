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
        this.currentContext = null; // Track the current playback context

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

            // Set up Spotify SDK when it's ready
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
            this.savePlaybackState();
        });

        // Save state periodically
        setInterval(() => {
            if (this.isReady && this.currentTrack) {
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

        // Set up event listeners
        if (this.connectBtn) {
            this.connectBtn.addEventListener('click', () => this.initiateSpotifyAuth());
        }

        if (this.playPauseBtn) {
            this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        }

        if (this.prevBtn) {
            this.prevBtn.addEventListener('click', () => this.previousTrack());
        }

        if (this.nextBtn) {
            this.nextBtn.addEventListener('click', () => this.nextTrack());
        }

        // Progress bar click handling
        if (this.progressBar) {
            this.progressBar.addEventListener('click', (e) => this.seekToPosition(e));
        }

        // Handle successful Spotify auth callback
        window.spotifyCallbackSuccess = () => {
            console.log('Spotify auth successful, checking tokens...');
            setTimeout(() => this.checkStoredTokens(), 1000);
        };

        window.spotifyCallbackError = (error) => {
            console.error('Spotify auth error:', error);
            this.showConnectButton();
        };

        // Check for auth completion flag (fallback if popup context is lost)
        if (localStorage.getItem('spotify_auth_just_completed') === 'true') {
            localStorage.removeItem('spotify_auth_just_completed');
            setTimeout(() => this.checkStoredTokens(), 500);
        }
    }

    // Show loading state
    showLoadingState() {
        if (this.playerContainer) {
            this.playerContainer.classList.add('reconnecting');
        }

        if (this.trackNameEl) {
            this.trackNameEl.textContent = 'Reconnecting...';
        }

        if (this.artistNameEl) {
            this.artistNameEl.textContent = 'Restoring playback state';
        }
    }

    // Hide loading state
    hideLoadingState() {
        if (this.playerContainer) {
            this.playerContainer.classList.remove('reconnecting');
        }
    }

    // Enhanced status message method
    showStatusMessage(message, type = 'info') {
        // Remove existing message
        const existing = document.querySelector('.spotify-status-message');
        if (existing) {
            existing.remove();
        }

        // Create new message
        const messageEl = document.createElement('div');
        messageEl.className = `spotify-status-message ${type}`;
        messageEl.textContent = message;
        document.body.appendChild(messageEl);

        // Show message
        setTimeout(() => messageEl.classList.add('show'), 100);

        // Hide message after 3 seconds
        setTimeout(() => {
            messageEl.classList.remove('show');
            setTimeout(() => messageEl.remove(), 300);
        }, 3000);
    }

    // Save current playback state to localStorage
    savePlaybackState() {
        if (!this.currentTrack || !this.isReady) return;

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
            duration: this.duration,
            timestamp: Date.now(),
            currentContext: this.currentContext // Save the context
        };

        localStorage.setItem('spotify_playback_state', JSON.stringify(state));
        console.log('Saved playback state:', state);
    }

    // Restore playback state from localStorage
    async restorePlaybackState() {
        const savedState = localStorage.getItem('spotify_playback_state');
        if (!savedState) {
            console.log('No saved playback state found');
            return;
        }

        try {
            this.showLoadingState();

            const state = JSON.parse(savedState);
            const timeSinceSave = Date.now() - state.timestamp;

            // Don't restore if state is too old (more than 30 minutes)
            if (timeSinceSave > 30 * 60 * 1000) {
                console.log('Saved state too old, not restoring');
                localStorage.removeItem('spotify_playback_state');
                this.hideLoadingState();
                return;
            }

            console.log('Restoring playback state:', state);

            // Set the track info immediately for UI
            this.currentTrack = state.currentTrack;
            this.isPlaying = state.isPlaying;
            this.duration = state.duration;
            this.currentContext = state.currentContext || null;

            // Calculate current position (add elapsed time if was playing)
            if (state.isPlaying) {
                this.position = Math.min(state.position + timeSinceSave, state.duration);
            } else {
                this.position = state.position;
            }

            // Update UI immediately
            this.updateUI();
            this.showPlayer();

            // Always transfer playback to our device first
            await this.transferPlayback();

            // Wait a moment for transfer to complete
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Restore with context if available
            if (this.currentContext && this.currentContext.uri) {
                console.log('Restoring with context:', this.currentContext);
                await this.resumeWithContext(this.currentContext, state.currentTrack.uri, this.position);
            } else if (state.currentTrack && state.currentTrack.uri) {
                console.log('Starting playback of saved track...');
                await this.resumeTrackFromPosition(state.currentTrack.uri, this.position);
            }

            // If it was paused, pause it after starting
            if (!state.isPlaying) {
                setTimeout(async () => {
                    await this.player.pause();
                    this.isPlaying = false;
                    this.updateUI();
                }, 2000);
            }

            this.hideLoadingState();
            this.showStatusMessage('Playback restored', 'success');

        } catch (error) {
            console.error('Error restoring playback state:', error);
            localStorage.removeItem('spotify_playback_state');
            this.hideLoadingState();
            this.showStatusMessage('Failed to restore playback', 'error');
        }
    }

    // Resume playback with context
    async resumeWithContext(context, trackUri, position) {
        if (!this.player || !this.isReady || !this.accessToken) {
            console.log('Cannot resume with context: player not ready');
            return;
        }

        try {
            let body = {
                context_uri: context.uri
            };

            // Find the track position in the context
            if (trackUri && context.type === 'album') {
                const trackId = trackUri.split(':')[2];
                const albumId = context.uri.split(':')[2];

                // Get album tracks to find position
                const albumResponse = await fetch(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`, {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                });

                if (albumResponse.ok) {
                    const albumData = await albumResponse.json();
                    const trackIndex = albumData.items.findIndex(t => t.id === trackId);
                    if (trackIndex !== -1) {
                        body.offset = { position: trackIndex };
                    }
                }
            }

            body.position_ms = Math.max(0, Math.floor(position));

            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (response.ok || response.status === 204) {
                console.log('Successfully resumed playback with context');
                return true;
            } else {
                console.error('Failed to resume with context:', response.status);
                // Fallback to single track
                return await this.resumeTrackFromPosition(trackUri, position);
            }
        } catch (error) {
            console.error('Error resuming with context:', error);
            return false;
        }
    }

    // Sync with Spotify's current playback state
    async syncWithSpotifyState() {
        if (!this.accessToken) return;

        try {
            const response = await fetch('https://api.spotify.com/v1/me/player', {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (response.status === 200) {
                const spotifyState = await response.json();

                if (spotifyState && spotifyState.item) {
                    console.log('Synced with Spotify state:', spotifyState);

                    // Update our state with Spotify's current state
                    this.currentTrack = {
                        uri: spotifyState.item.uri,
                        name: spotifyState.item.name,
                        artists: spotifyState.item.artists,
                        album: spotifyState.item.album,
                        duration_ms: spotifyState.item.duration_ms
                    };

                    this.isPlaying = spotifyState.is_playing;
                    this.position = spotifyState.progress_ms;
                    this.duration = spotifyState.item.duration_ms;

                    // Update context information
                    if (spotifyState.context) {
                        this.currentContext = {
                            type: spotifyState.context.type,
                            uri: spotifyState.context.uri
                        };
                    }

                    this.updateUI();

                    if (this.isPlaying) {
                        this.startProgressTimer();
                    }
                }
            } else if (response.status === 204) {
                // No active playback
                console.log('No active Spotify playback');
            }
        } catch (error) {
            console.error('Error syncing with Spotify state:', error);
        }
    }

    // Resume a specific track from a specific position
    async resumeTrackFromPosition(uri, position) {
        if (!this.player || !this.isReady || !this.accessToken) {
            console.log('Cannot resume track: player not ready');
            return;
        }

        try {
            console.log(`Resuming track ${uri} from position ${position}ms`);

            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    uris: [uri],
                    position_ms: Math.max(0, Math.floor(position))
                })
            });

            if (response.ok || response.status === 204) {
                console.log('Successfully resumed playback');
                return true;
            } else {
                const errorText = await response.text();
                console.error('Failed to resume playback:', response.status, errorText);

                // If we get a 404, the device might not be active, try transferring first
                if (response.status === 404) {
                    console.log('Device not found, trying to transfer playback...');
                    const transferred = await this.transferPlayback();
                    if (transferred) {
                        // Retry after a short delay
                        setTimeout(() => this.resumeTrackFromPosition(uri, position), 2000);
                    }
                }
                return false;
            }

        } catch (error) {
            console.error('Error resuming playback:', error);
            return false;
        }
    }

    checkStoredTokens() {
        const accessToken = localStorage.getItem('visitor_spotify_access_token');
        const expiresAt = localStorage.getItem('visitor_spotify_token_expires_at');

        if (accessToken && expiresAt) {
            const now = new Date().getTime();
            const expiry = parseInt(expiresAt);

            if (now < expiry) {
                console.log('Valid Spotify token found, initializing player...');
                this.accessToken = accessToken;
                this.initSpotifySDK();
                return;
            } else {
                console.log('Spotify token expired, attempting refresh...');
                this.refreshAccessToken();
                return;
            }
        }

        console.log('No valid Spotify tokens found');
        this.showConnectButton();
    }

    async refreshAccessToken() {
        const refreshToken = localStorage.getItem('visitor_spotify_refresh_token');

        if (!refreshToken) {
            console.log('No refresh token available');
            this.showConnectButton();
            return;
        }

        try {
            const response = await fetch('/api/spotify/refresh-visitor-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Store new tokens
            localStorage.setItem('visitor_spotify_access_token', data.access_token);
            const expiresAt = new Date().getTime() + (data.expires_in * 1000);
            localStorage.setItem('visitor_spotify_token_expires_at', expiresAt.toString());

            if (data.refresh_token) {
                localStorage.setItem('visitor_spotify_refresh_token', data.refresh_token);
            }

            this.accessToken = data.access_token;
            this.initSpotifySDK();

        } catch (error) {
            console.error('Error refreshing Spotify token:', error);
            this.clearStoredTokens();
            this.showConnectButton();
        }
    }

    clearStoredTokens() {
        localStorage.removeItem('visitor_spotify_access_token');
        localStorage.removeItem('visitor_spotify_refresh_token');
        localStorage.removeItem('visitor_spotify_token_expires_at');
        localStorage.removeItem('spotify_playback_state');
    }

    showConnectButton() {
        if (this.connectBtn) {
            this.connectBtn.style.display = 'block';
        }
        if (this.playerContainer) {
            this.playerContainer.style.display = 'none';
        }
    }

    hideConnectButton() {
        if (this.connectBtn) {
            this.connectBtn.style.display = 'none';
        }
    }

    showPlayer() {
        if (this.playerContainer) {
            this.playerContainer.style.display = 'flex';
            // Add animation class
            this.playerContainer.style.animation = 'slideUpPlayer 0.5s ease-out';
        }
        this.hideConnectButton();
    }

    initiateSpotifyAuth() {
        // Open auth popup
        const authUrl = '/spotify/initiate-auth';
        const popup = window.open(authUrl, 'spotify-auth', 'width=500,height=600,scrollbars=yes,resizable=yes');

        // Monitor popup
        const checkClosed = setInterval(() => {
            if (!popup || popup.closed) {
                clearInterval(checkClosed);
                // Check for tokens after popup closes
                setTimeout(() => this.checkStoredTokens(), 1000);
            }
        }, 1000);
    }

    initSpotifySDK() {
        if (!this.accessToken || !window.Spotify) {
            console.log('Cannot initialize Spotify SDK - missing token or SDK not loaded');
            return;
        }

        console.log('Initializing Spotify Web Playback SDK...');

        this.player = new Spotify.Player({
            name: 'Ben\'s Neurascape Web Player',
            getOAuthToken: (cb) => {
                cb(this.accessToken);
            },
            volume: 0.5
        });

        // Error handling
        this.player.addListener('initialization_error', ({ message }) => {
            console.error('Spotify initialization error:', message);
        });

        this.player.addListener('authentication_error', ({ message }) => {
            console.error('Spotify authentication error:', message);
            this.refreshAccessToken();
        });

        this.player.addListener('account_error', ({ message }) => {
            console.error('Spotify account error:', message);
            this.showStatusMessage('Spotify account error. Premium required.', 'error');
        });

        this.player.addListener('playback_error', ({ message }) => {
            console.error('Spotify playback error:', message);

            // Handle specific error cases
            if (message.includes('no list was loaded')) {
                console.log('No active playback context - this is normal when restoring state');
            } else {
                this.showStatusMessage('Playback error: ' + message, 'error');
            }
        });

        // Playback status updates
        this.player.addListener('player_state_changed', (state) => {
            console.log('Player state changed:', state);

            if (!state) {
                console.log('No state - playback might have stopped');
                // Don't clear UI immediately, might just be a temporary state
                return;
            }

            // Update our internal state
            this.currentTrack = state.track_window.current_track;
            this.isPlaying = !state.paused;
            this.position = state.position;
            this.duration = state.duration;

            // Update context if available
            if (state.context) {
                this.currentContext = {
                    type: state.context.metadata?.context_description || 'unknown',
                    uri: state.context.uri
                };
            }

            console.log('Updated state:', {
                track: this.currentTrack?.name,
                isPlaying: this.isPlaying,
                position: this.position,
                duration: this.duration,
                context: this.currentContext
            });

            this.updateUI();

            // Handle progress updates
            if (this.isPlaying) {
                this.startProgressTimer();
            } else {
                this.stopProgressTimer();
            }

            // Save state when it changes (but not too frequently)
            clearTimeout(this.saveStateTimeout);
            this.saveStateTimeout = setTimeout(() => {
                this.savePlaybackState();
            }, 1000);
        });

        // Ready
        this.player.addListener('ready', ({ device_id }) => {
            console.log('Spotify Web Player ready with Device ID:', device_id);
            this.deviceId = device_id;
            this.isReady = true;
            this.showPlayer();

            // Dispatch custom event
            document.dispatchEvent(new Event('spotifyPlayerReady'));

            // Restore previous playback state after a delay
            setTimeout(() => this.restorePlaybackState(), 2000);

            // Start periodic state checking
            this.startStateCheck();
        });

        // Not ready
        this.player.addListener('not_ready', ({ device_id }) => {
            console.log('Spotify Web Player not ready with Device ID:', device_id);
            this.isReady = false;
            this.stopStateCheck();
        });

        // Connect to the player
        this.player.connect().then(success => {
            if (success) {
                console.log('Successfully connected to Spotify Web Player');
            } else {
                console.error('Failed to connect to Spotify Web Player');
                this.showStatusMessage('Failed to connect to Spotify', 'error');
            }
        });
    }

    // Periodically check Spotify's state to stay in sync
    startStateCheck() {
        this.stopStateCheck();
        this.stateCheckInterval = setInterval(() => {
            this.syncWithSpotifyState();
        }, 30000);
    }

    stopStateCheck() {
        if (this.stateCheckInterval) {
            clearInterval(this.stateCheckInterval);
            this.stateCheckInterval = null;
        }
    }

    startProgressTimer() {
        this.stopProgressTimer(); // Clear any existing timer

        this.progressInterval = setInterval(() => {
            if (this.isPlaying && this.duration > 0) {
                this.position += 1000; // Add 1 second

                // Clamp position to duration
                if (this.position > this.duration) {
                    this.position = this.duration;
                }

                this.updateProgress();
            }
        }, 1000);
    }

    stopProgressTimer() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    updateUI() {
        if (!this.currentTrack) return;

        // Update track info
        if (this.trackNameEl) {
            this.trackNameEl.textContent = this.currentTrack.name;
            this.trackNameEl.classList.add('updating');
            setTimeout(() => this.trackNameEl.classList.remove('updating'), 500);
        }

        if (this.artistNameEl) {
            this.artistNameEl.textContent = this.currentTrack.artists.map(artist => artist.name).join(', ');
        }

        if (this.albumArtEl && this.currentTrack.album.images.length > 0) {
            this.albumArtEl.src = this.currentTrack.album.images[0].url;
            this.albumArtEl.alt = `${this.currentTrack.album.name} album art`;
        }

        // Update play/pause button
        if (this.playPauseBtn) {
            const icon = this.playPauseBtn.querySelector('i');
            if (icon) {
                icon.className = this.isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            }
            this.playPauseBtn.title = this.isPlaying ? 'Pause' : 'Play';
        }

        // Update progress
        this.updateProgress();
    }

    updateProgress() {
        if (this.duration > 0) {
            const progressPercent = (this.position / this.duration) * 100;

            if (this.progressFill) {
                this.progressFill.style.width = `${progressPercent}%`;
            }

            if (this.currentTimeEl) {
                this.currentTimeEl.textContent = this.formatTime(this.position);
            }

            if (this.durationEl) {
                this.durationEl.textContent = this.formatTime(this.duration);
            }
        }
    }

    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    seekToPosition(e) {
        if (!this.player || !this.isReady || !this.duration) return;

        const rect = this.progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const position = Math.floor(percent * this.duration);

        this.player.seek(position).catch(error => {
            console.error('Error seeking:', error);
        });
    }

    async togglePlayPause() {
        if (!this.player || !this.isReady) {
            console.log('Player not ready');
            return;
        }

        try {
            if (this.isPlaying) {
                console.log('Pausing playback...');
                await this.player.pause();
            } else {
                console.log('Resuming playback...');
                // First check if we have an active context
                const context = await this.getCurrentPlaybackContext();

                if (!context || !context.item) {
                    this.showStatusMessage('No track loaded. Try playing a track first.', 'error');
                    return;
                }

                await this.player.resume();
            }
        } catch (error) {
            console.error('Error toggling playback:', error);
            await this.handlePlaybackError(error, 'togglePlayPause');

            // If controls fail, try to get current state and restart if needed
            setTimeout(() => this.syncWithSpotifyState(), 1000);
        }
    }

    async previousTrack() {
        if (!this.player || !this.isReady || !this.accessToken) {
            console.log('Player not ready or no access token');
            return;
        }

        try {
            console.log('Going to previous track...');

            // Ensure device is active first
            const deviceActive = await this.ensureDeviceActive();
            if (!deviceActive) {
                this.showStatusMessage('Failed to activate player device', 'error');
                return;
            }

            // Try using the Web API
            const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok || response.status === 204) {
                console.log('Successfully went to previous track');
                // Sync state after a short delay
                setTimeout(() => this.syncWithSpotifyState(), 1000);
            } else if (response.status === 404) {
                // Device not found - try to reactivate
                console.log('Device not found, reactivating...');
                await this.transferPlayback();
                setTimeout(() => this.previousTrack(), 1000);
            } else if (response.status === 403) {
                // No previous track available
                this.showStatusMessage('No previous track available', 'info');
            } else {
                console.error('Failed to go to previous track:', response.status);
                this.showStatusMessage('Cannot go to previous track. Try playing an album or playlist.', 'error');
            }
        } catch (error) {
            console.error('Error going to previous track:', error);
            this.showStatusMessage('Error changing track', 'error');
        }
    }

    async nextTrack() {
        if (!this.player || !this.isReady || !this.accessToken) {
            console.log('Player not ready or no access token');
            return;
        }

        try {
            console.log('Going to next track...');

            // Ensure device is active first
            const deviceActive = await this.ensureDeviceActive();
            if (!deviceActive) {
                this.showStatusMessage('Failed to activate player device', 'error');
                return;
            }

            // Try using the Web API
            const response = await fetch('https://api.spotify.com/v1/me/player/next', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok || response.status === 204) {
                console.log('Successfully went to next track');
                // Sync state after a short delay
                setTimeout(() => this.syncWithSpotifyState(), 1000);
            } else if (response.status === 404) {
                // Device not found - try to reactivate
                console.log('Device not found, reactivating...');
                await this.transferPlayback();
                setTimeout(() => this.nextTrack(), 1000);
            } else if (response.status === 403) {
                // No next track available
                this.showStatusMessage('No next track available', 'info');
            } else {
                console.error('Failed to go to next track:', response.status);
                this.showStatusMessage('Cannot go to next track. Try playing an album or playlist.', 'error');
            }
        } catch (error) {
            console.error('Error going to next track:', error);
            this.showStatusMessage('Error changing track', 'error');
        }
    }

    // Method to play a specific track (can be called from music pages)
    async playTrack(uri) {
        if (!this.player || !this.isReady || !this.accessToken) {
            console.log('Player not ready or no access token');
            return;
        }

        try {
            console.log('Playing track:', uri);

            // Always transfer playback to our device first
            await this.transferPlayback();

            // Wait a moment for transfer
            await new Promise(resolve => setTimeout(resolve, 500));

            // First, try to get the track details to find its album
            const trackId = uri.split(':')[2];
            let playbackBody = { uris: [uri] }; // Fallback to single track

            try {
                const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                });

                if (trackResponse.ok) {
                    const track = await trackResponse.json();
                    if (track.album && track.album.uri && track.album.total_tracks > 1) {
                        // Only use album context if it has multiple tracks
                        const albumUri = track.album.uri;
                        const trackNumber = track.track_number - 1; // 0-indexed

                        console.log(`Playing album ${albumUri} starting at track ${trackNumber + 1}`);

                        playbackBody = {
                            context_uri: albumUri,
                            offset: { position: trackNumber }
                        };

                        // Store the context
                        this.currentContext = {
                            type: 'album',
                            uri: albumUri
                        };
                    } else {
                        console.log('Single track or no album context, playing individual track');
                        this.currentContext = null;
                    }
                }
            } catch (albumError) {
                console.log('Could not get album context, playing single track:', albumError);
                this.currentContext = null;
            }

            // Start playback with the determined context
            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(playbackBody)
            });

            if (response.ok || response.status === 204) {
                console.log('Started playback for:', uri);
                this.showStatusMessage('Starting playback...', 'success');
            } else {
                const errorText = await response.text();
                console.error('Failed to start playback:', response.status, errorText);
                this.showStatusMessage('Failed to start playback', 'error');
            }
        } catch (error) {
            console.error('Error starting playback:', error);
            this.showStatusMessage('Failed to start playback', 'error');
        }
    }

    // Method to play an album or playlist
    async playContext(contextUri, offset = 0) {
        if (!this.player || !this.isReady || !this.accessToken) {
            console.log('Player not ready or no access token');
            return;
        }

        try {
            console.log('Playing context:', contextUri);

            // Always transfer playback to our device first
            await this.transferPlayback();

            // Wait a moment for transfer
            await new Promise(resolve => setTimeout(resolve, 500));

            const body = { context_uri: contextUri };
            if (offset > 0) {
                body.offset = { position: offset };
            }

            // Store the context
            this.currentContext = {
                type: contextUri.includes('album') ? 'album' : 'playlist',
                uri: contextUri
            };

            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (response.ok || response.status === 204) {
                console.log('Started context playback for:', contextUri);
                this.showStatusMessage('Starting playback...', 'success');
            } else {
                const errorText = await response.text();
                console.error('Failed to start context playback:', response.status, errorText);
                this.showStatusMessage('Failed to start playback', 'error');
            }
        } catch (error) {
            console.error('Error starting context playback:', error);
            this.showStatusMessage('Failed to start playback', 'error');
        }
    }

    // Transfer playback to this device
    async transferPlayback() {
        if (!this.deviceId || !this.accessToken) {
            console.log('Cannot transfer playback: missing device ID or access token');
            return false;
        }

        try {
            console.log('Transferring playback to web player...');
            const response = await fetch('https://api.spotify.com/v1/me/player', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    device_ids: [this.deviceId],
                    play: false
                })
            });

            if (response.ok || response.status === 204) {
                console.log('Playback transferred to web player');
                return true;
            } else {
                console.error('Failed to transfer playback:', response.status);
                return false;
            }
        } catch (error) {
            console.error('Error transferring playback:', error);
            return false;
        }
    }

    // Ensure device is active before making control requests
    async ensureDeviceActive() {
        if (!this.deviceId || !this.accessToken) {
            return false;
        }

        try {
            // Check current playback state
            const response = await fetch('https://api.spotify.com/v1/me/player', {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (response.status === 200) {
                const state = await response.json();
                // Check if our device is the active device
                if (state.device && state.device.id === this.deviceId) {
                    return true;
                }
            }

            // If not active, transfer playback
            console.log('Device not active, transferring playback...');
            return await this.transferPlayback();
        } catch (error) {
            console.error('Error ensuring device active:', error);
            return false;
        }
    }

    // Enhanced method to handle playback errors gracefully
    async handlePlaybackError(error, context = '') {
        console.error(`Playback error in ${context}:`, error);

        if (error.message && error.message.includes('404')) {
            this.showStatusMessage('No active playback session. Try playing a track first.', 'error');
        } else if (error.message && error.message.includes('403')) {
            this.showStatusMessage('Premium account required for this feature.', 'error');
        } else {
            this.showStatusMessage(`Playback error: ${error.message || 'Unknown error'}`, 'error');
        }
    }

    // Add tracks to queue (alternative approach for better context)
    async addToQueue(uri) {
        if (!this.accessToken) {
            console.log('No access token for queue management');
            return false;
        }

        try {
            const response = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (response.ok || response.status === 204) {
                console.log('Added to queue:', uri);
                return true;
            } else {
                console.error('Failed to add to queue:', response.status);
                return false;
            }
        } catch (error) {
            console.error('Error adding to queue:', error);
            return false;
        }
    }

    // Get current playback context for better error handling
    async getCurrentPlaybackContext() {
        if (!this.accessToken) return null;

        try {
            const response = await fetch('https://api.spotify.com/v1/me/player', {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (response.ok) {
                return await response.json();
            }
            return null;
        } catch (error) {
            console.error('Error getting playback context:', error);
            return null;
        }
    }

    // Cleanup method
    disconnect() {
        this.stopProgressTimer();
        this.stopStateCheck();
        this.savePlaybackState();
        if (this.player) {
            this.player.disconnect();
        }
    }
}

// Global instance
window.spotifyPlayer = new SpotifyWebPlayer();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.spotifyPlayer) {
        window.spotifyPlayer.stopProgressTimer();
    }
});