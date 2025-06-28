const AWS = require('aws-sdk');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Constants
const MAX_RESULTS = 200;
const S3_BUCKET = 'doggyhits.com';
const SECRET_NAME = 'DoggyHitsYouTubeAPIKey';

// Initialize AWS clients
const s3 = new AWS.S3();
const secretsManager = new AWS.SecretsManager();

// Function to get YouTube API Key from Secrets Manager
async function getYouTubeAPIKey() {
    try {
        console.log(`Retrieving YouTube API key from Secrets Manager: ${SECRET_NAME}`);
        const data = await secretsManager.getSecretValue({ SecretId: SECRET_NAME }).promise();
        
        let secretValue = null;
        
        // Extract the actual secret value
        if ('SecretString' in data) {
            secretValue = data.SecretString;
        } else if (data.SecretBinary) {
            const buff = Buffer.from(data.SecretBinary, 'base64');
            secretValue = buff.toString('ascii');
        }
        
        if (!secretValue) {
            throw new Error('Retrieved secret is empty or invalid');
        }
        
        // Log the raw secret value for debugging (first few characters)
        console.log(`Raw secret value (first few chars): ${secretValue.substring(0, 20)}...`);
        
        // Parse the JSON structure
        try {
            const secretJson = JSON.parse(secretValue);
            
            // Check if the secret contains the expected key
            if (secretJson.DoggyHitsYoutubeAPIkey) {
                const apiKey = secretJson.DoggyHitsYoutubeAPIkey.trim();
                console.log(`Successfully extracted API key (first few chars): ${apiKey.substring(0, 5)}...`);
                return apiKey;
            } else {
                // Try alternative key formats in case of case sensitivity issues
                const possibleKeys = Object.keys(secretJson);
                console.log(`Available keys in secret: ${JSON.stringify(possibleKeys)}`);
                
                // Try to find a key that looks like our target
                for (const key of possibleKeys) {
                    if (key.toLowerCase().includes('apikey') || key.toLowerCase().includes('youtube')) {
                        const apiKey = secretJson[key].trim();
                        console.log(`Found alternative key "${key}" with value (first few chars): ${apiKey.substring(0, 5)}...`);
                        return apiKey;
                    }
                }
                
                throw new Error(`Secret JSON does not contain expected key. Available keys: ${JSON.stringify(possibleKeys)}`);
            }
        } catch (parseError) {
            // If parsing fails, the secret might be a plain string (just the API key)
            console.log(`JSON parsing failed, treating secret as plain string: ${parseError.message}`);
            const apiKey = secretValue.trim();
            console.log(`Using secret as plain string API key (first few chars): ${apiKey.substring(0, 5)}...`);
            return apiKey;
        }
    } catch (error) {
        console.error(`Error retrieving secret: ${error.message}`);
        throw new Error(`Failed to retrieve YouTube API key: ${error.message}`);
    }
}

// Function to fetch dog videos from YouTube API
async function fetchDogVideos(apiKey) {
    return new Promise((resolve, reject) => {
        console.log(`Using API key (first few chars): ${apiKey.substring(0, 5)}...`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=${MAX_RESULTS}&q=funny+dogs&type=video&order=date&key=${apiKey}`;
        
        https.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    if (jsonData.error) {
                        reject(new Error(`YouTube API Error: ${jsonData.error.message}`));
                    } else {
                        resolve(jsonData);
                    }
                } catch (error) {
                    reject(new Error(`Error parsing YouTube API response: ${error.message}`));
                }
            });
        }).on('error', (error) => {
            reject(new Error(`Error fetching videos: ${error.message}`));
        });
    });
}

// Function to convert date to Australia EST time
function convertToAustraliaEST(date) {
    const options = {
        timeZone: 'Australia/Sydney',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    
    return date.toLocaleString('en-AU', options);
}

// Function to generate HTML content
function generateHTML(videos) {
    // Get the most recent video for the timestamp
    let lastUpdatedText = 'Last video updated: No videos found';
    
    if (videos.items && videos.items.length > 0) {
        const mostRecentVideo = videos.items[0];
        const publishDate = new Date(mostRecentVideo.snippet.publishedAt);
        const australiaTime = convertToAustraliaEST(publishDate);
        lastUpdatedText = `Last video updated: ${australiaTime}`;
    }
    
    // Complete HTML template
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Funny Dog Videos</title>
    <link rel="stylesheet" href="css/style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
    <style>
        /* Styles for watched videos indicator */
        .played-indicator {
            display: none;
            font-size: 0.8em;
            color: #555;
            background-color: #f1f1f1;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 5px;
            font-weight: bold;
        }
        
        .video-item.watched .played-indicator {
            display: inline-block;
        }
        
        /* Play All button styles */
        .play-all-button {
            display: block;
            margin: 20px auto;
            padding: 12px 24px;
            background-color: #ff5722;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 1.2em;
            font-weight: bold;
            cursor: pointer;
            transition: background-color 0.3s ease;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }
        
        .play-all-button:hover {
            background-color: #e64a19;
        }
        
        .play-all-button i {
            margin-right: 8px;
        }
        
        /* Queue indicator styles */
        .queue-indicator {
            position: absolute;
            top: 5px;
            right: 5px;
            background-color: rgba(0,0,0,0.7);
            color: white;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 0.8em;
            display: none;
        }
        
        .video-item.in-queue .queue-indicator {
            display: block;
        }
        
        .video-item.current-playing {
            border: 3px solid #ff5722;
        }
        
        /* Video counter styles */
        .video-counter {
            position: absolute;
            top: 10px;
            left: 10px;
            background-color: rgba(0,0,0,0.7);
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 0.9em;
            z-index: 1001;
        }
        
        /* Next/Previous button styles */
        .player-controls {
            display: flex;
            justify-content: space-between;
            margin-top: 10px;
            margin-bottom: 15px;
        }
        
        .player-controls button {
            padding: 8px 16px;
            background-color: #444;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.3s ease;
        }
        
        .player-controls button:hover {
            background-color: #666;
        }
        
        .player-controls button:disabled {
            background-color: #ccc;
            cursor: not-allowed;
        }
        
        /* Video info text styles */
        #video-info h3 {
            font-size: 1.1em;
            margin-top: 0;
        }
        
        #video-info p {
            font-size: 0.9em;
            line-height: 1.4;
            color: #333;
        }
    </style>

    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-69T8E57ETV"></script>
    <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', 'G-69T8E57ETV');
    </script>
    
</head>
<body>
    <header>
        <div class="container">
            <h1>Funny Dog Videos</h1>
            <p> Get Your Doggy Dopamine Hits ! </p>
           
            <p id="last-updated" class="last-updated">${lastUpdatedText}</p>
        </div>
    </header>

    <main class="container">
        <!-- Play All Button -->
        <button id="play-all-button" class="play-all-button">
            <i class="fas fa-play-circle"></i> Play All Videos
        </button>
        
        <div id="videos-container" class="videos-grid">
        </div>

        <div id="video-modal" class="modal">
            <div class="modal-content">
                <span class="close-button">&times;</span>
                <div id="video-counter" class="video-counter"></div>
                <div id="video-player"></div>
                <!-- Player controls moved up, directly under the video player -->
                <div id="player-controls" class="player-controls">
                    <button id="prev-video-button" disabled>
                        <i class="fas fa-step-backward"></i> Previous
                    </button>
                    <button id="next-video-button">
                        <i class="fas fa-step-forward"></i> Next
                    </button>
                </div>
                <div id="video-info">
                    <h3 id="video-title"></h3>
                    <p id="video-description"></p>
                </div>
            </div>
        </div>
    </main>

    <footer>
        <div class="container">
            <p>&copy; 2025 DoggyHits - All rights reserved</p>
        </div>
    </footer>

    <script>
        // Embed video data for client-side access
        const videos = ${JSON.stringify(videos)};
        
        // Modal functionality
        const videoModal = document.getElementById('video-modal');
        const closeButton = document.querySelector('.close-button');
        const videoPlayer = document.getElementById('video-player');
        const videoTitle = document.getElementById('video-title');
        const videoDescription = document.getElementById('video-description');
        const playAllButton = document.getElementById('play-all-button');
        const prevVideoButton = document.getElementById('prev-video-button');
        const nextVideoButton = document.getElementById('next-video-button');
        const videoCounter = document.getElementById('video-counter');
        
        // Global variables
        let youtubePlayer = null;
        let videoEndTimer = null;
        let videoQueue = [];
        let currentQueueIndex = -1;
        let isPlayingAll = false;
        
        // Cookie functions for persistence
        function setCookie(name, value, days) {
            const expires = new Date();
            expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
            document.cookie = name + '=' + value + ';expires=' + expires.toUTCString() + ';path=/';
        }
        
        function getCookie(name) {
            const nameEQ = name + '=';
            const ca = document.cookie.split(';');
            for (let i = 0; i < ca.length; i++) {
                let c = ca[i];
                while (c.charAt(0) === ' ') c = c.substring(1, c.length);
                if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
            }
            return null;
        }
        
        // Track watched videos with Set and cookie persistence
        const watchedVideos = new Set();
        
        // Load watched videos from cookie on page load
        function loadWatchedVideosFromCookie() {
            const watchedCookie = getCookie('doggyHitsWatched');
            if (watchedCookie) {
                try {
                    const watchedArray = JSON.parse(watchedCookie);
                    watchedArray.forEach(videoId => watchedVideos.add(videoId));
                } catch (e) {
                    console.error('Error parsing watched videos cookie:', e);
                }
            }
        }
        
        // Save watched videos to cookie
        function saveWatchedVideosToCookie() {
            const watchedArray = Array.from(watchedVideos);
            setCookie('doggyHitsWatched', JSON.stringify(watchedArray), 30); // Store for 30 days
        }
        
        // Load watched videos when page loads
        loadWatchedVideosFromCookie();
        
        // Build video queue from all videos
        function buildVideoQueue(videos) {
            videoQueue = [];
            if (videos.items && videos.items.length > 0) {
                videos.items.forEach(video => {
                    const videoId = video.id.videoId;
                    const snippet = video.snippet;
                    const title = snippet.title;
                    const description = snippet.description;
                    videoQueue.push({
                        videoId: videoId,
                        title: title,
                        description: description
                    });
                });
            }
            return videoQueue;
        }
        
        // Update video counter display
        function updateVideoCounter() {
            if (isPlayingAll && currentQueueIndex >= 0) {
                videoCounter.textContent = "Video " + (currentQueueIndex + 1) + " of " + videoQueue.length;
                videoCounter.style.display = 'block';
            } else {
                videoCounter.style.display = 'none';
            }
        }
        
        // Update player controls state
        function updatePlayerControls() {
            if (isPlayingAll) {
                prevVideoButton.disabled = currentQueueIndex <= 0;
                nextVideoButton.disabled = currentQueueIndex >= videoQueue.length - 1;
                
                // Show the controls
                document.getElementById('player-controls').style.display = 'flex';
            } else {
                // Hide the controls when not in play all mode
                document.getElementById('player-controls').style.display = 'none';
            }
        }
        
        // Play All button click handler
        playAllButton.addEventListener("click", () => {
            // Build the queue
            buildVideoQueue(videos);
            
            // Set play all mode
            isPlayingAll = true;
            currentQueueIndex = 0;
            
            // Start playing the first video
            if (videoQueue.length > 0) {
                const firstVideo = videoQueue[0];
                playVideoFromQueue(0);
            }
        });
        
        // Previous video button click handler
        prevVideoButton.addEventListener('click', () => {
            if (isPlayingAll && currentQueueIndex > 0) {
                playVideoFromQueue(currentQueueIndex - 1);
            }
        });
        
        // Next video button click handler
        nextVideoButton.addEventListener('click', () => {
            if (isPlayingAll && currentQueueIndex < videoQueue.length - 1) {
                playVideoFromQueue(currentQueueIndex + 1);
            }
        });
        
        // Play video from queue
        function playVideoFromQueue(index) {
            if (index >= 0 && index < videoQueue.length) {
                currentQueueIndex = index;
                const video = videoQueue[index];
                
                // Mark video as watched
                watchedVideos.add(video.videoId);
                
                // Save to cookie
                saveWatchedVideosToCookie();
                
                // Open the video in the modal
                openVideoModal(video.videoId, video.title, video.description);
                
                // Update counter and controls
                updateVideoCounter();
                updatePlayerControls();
            }
        }
        

        
        // Close modal when clicking close button
        closeButton.addEventListener('click', closeModal);
        
        // Close modal when clicking outside content
        window.addEventListener('click', (e) => {
            if (e.target === videoModal) {
                closeModal();
            }
        });
        
        // Open modal and play video
        function openVideoModal(videoId, title, description) {
            // Clear any existing timers
            if (videoEndTimer) {
                clearTimeout(videoEndTimer);
                videoEndTimer = null;
            }
            
            // Set video player iframe with event listener for video end
            videoPlayer.innerHTML = '<iframe id="youtube-iframe" src="https://www.youtube.com/embed/' + videoId + '?autoplay=1&enablejsapi=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
            
            // Set video information
            videoTitle.textContent = title;
            videoDescription.textContent = description;
            
            // Show modal
            videoModal.style.display = 'block';
            
            // Disable scrolling on body
            document.body.style.overflow = 'hidden';
            
            // Add YouTube API script if not already added
            if (!window.YT) {
                const tag = document.createElement('script');
                tag.src = 'https://www.youtube.com/iframe_api';
                const firstScriptTag = document.getElementsByTagName('script')[0];
                firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
            }
            
            // Initialize YouTube player when API is ready
            window.onYouTubeIframeAPIReady = function() {
                initializeYouTubePlayer(videoId);
            };
            
            // If YouTube API is already loaded, initialize player directly
            if (window.YT && window.YT.Player) {
                initializeYouTubePlayer(videoId);
            }
        }
        
        // Initialize YouTube player with API
        function initializeYouTubePlayer(videoId) {
            try {
                const iframe = document.getElementById('youtube-iframe');
                if (iframe) {
                    youtubePlayer = new YT.Player('youtube-iframe', {
                        events: {
                            'onStateChange': onPlayerStateChange,
                            'onReady': onPlayerReady
                        }
                    });
                }
            } catch (error) {
                console.error('Error initializing YouTube player:', error);
            }
        }
        
        // When player is ready, set up time monitoring
        function onPlayerReady(event) {
            // Start monitoring video time
            monitorVideoTime();
        }
        
        // Monitor video time to show controls near the end
        function monitorVideoTime() {
            if (youtubePlayer && youtubePlayer.getPlayerState) {
                const playerState = youtubePlayer.getPlayerState();
                
                // Only monitor if video is playing (state 1)
                if (playerState === 1) {
                    const duration = youtubePlayer.getDuration();
                    const currentTime = youtubePlayer.getCurrentTime();
                    const timeRemaining = duration - currentTime;
                    
                    // If less than 2 seconds remaining, show controls
                    if (timeRemaining <= 2 && timeRemaining > 0) {
                        youtubePlayer.unMute(); // Ensure audio is on
                        youtubePlayer.playVideo(); // Ensure video is playing
                        
                        // Show controls by sending a user activity event
                        try {
                            const iframe = document.getElementById('youtube-iframe');
                            if (iframe && iframe.contentWindow) {
                                iframe.contentWindow.postMessage('{"event":"command","func":"showControls","args":""}', '*');
                            }
                        } catch (e) {
                            console.error('Error showing controls:', e);
                        }
                    }
                }
                
                // Continue monitoring every 200ms
                setTimeout(monitorVideoTime, 200);
            }
        }
        
        // Handle player state changes
        function onPlayerStateChange(event) {
            // State 0 means the video has ended
            if (event.data === 0) {
                if (isPlayingAll && currentQueueIndex < videoQueue.length - 1) {
                    // Play next video in queue after a short delay
                    videoEndTimer = setTimeout(() => {
                        playVideoFromQueue(currentQueueIndex + 1);
                    }, 1000);
                } else {
                    // Add a 1-second delay before closing if not in play all mode
                    // or if we've reached the end of the queue
                    videoEndTimer = setTimeout(() => {
                        closeModal();
                    }, 1000);
                }
            }
        }
        
        // Close modal
        function closeModal() {
            // Clear any existing timers
            if (videoEndTimer) {
                clearTimeout(videoEndTimer);
                videoEndTimer = null;
            }
            
            // Reset YouTube player variable
            youtubePlayer = null;
            
            // Clear video player
            videoPlayer.innerHTML = '';
            
            // Hide modal
            videoModal.style.display = 'none';
            
            // Enable scrolling on body
            document.body.style.overflow = 'auto';
            
            // Reset play all mode
            isPlayingAll = false;
            

        }
        
        // Auto-trigger Play All when page loads
        window.addEventListener('load', () => {
            // Small delay to ensure everything is loaded
            setTimeout(() => {
                // Directly trigger Play All functionality instead of simulating click
                // Build the queue
                buildVideoQueue(videos);
                
                // Set play all mode
                isPlayingAll = true;
                currentQueueIndex = 0;
                
                // Start playing the first video
                if (videoQueue.length > 0) {
                    const firstVideo = videoQueue[0];
                    playVideoFromQueue(0);
                }
            }, 1000); // Increased delay to ensure everything is ready
        });

    </script>
</body>
</html>`;
}

// Function to upload file to S3
async function uploadToS3(content, key, contentType) {
    const params = {
        Bucket: S3_BUCKET,
        Key: key,
        Body: content,
        ContentType: contentType
    };
    
    return s3.putObject(params).promise();
}

// Main Lambda handler
exports.handler = async (event) => {
    try {
        console.log('Starting DoggyHits Lambda function');
        
        // Get YouTube API key from Secrets Manager
        console.log('Retrieving YouTube API key from Secrets Manager');
        const apiKey = await getYouTubeAPIKey();
        
        // Verify we have a valid API key
        if (!apiKey || apiKey.length < 10) {
            throw new Error(`Retrieved API key appears invalid: ${apiKey ? apiKey.substring(0, 3) + '...' : 'empty'}`);
        }
        
        // Fetch videos from YouTube API
        console.log('Fetching videos from YouTube API');
        const videos = await fetchDogVideos(apiKey);
        
        // Generate HTML content
        console.log('Generating HTML content');
        const htmlContent = generateHTML(videos);
        
        // Upload HTML to S3
        console.log('Uploading index.html to S3');
        await uploadToS3(htmlContent, 'index.html', 'text/html');
        
        console.log('Successfully updated DoggyHits website');
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Successfully updated DoggyHits website' })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
